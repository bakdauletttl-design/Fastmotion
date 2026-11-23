"""Официальный API Twitch (Helix): поиск стримеров, аватарки и клипы, которые делают сами зрители.

Нужны TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET (бесплатно на dev.twitch.tv).
Без них всё работает, просто без поиска, аватарок и этого сигнала.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)
HELIX = "https://api.twitch.tv/helix"


class Twitch:
    def __init__(self, client_id: str | None = None, secret: str | None = None,
                 http: httpx.Client | None = None):
        self.client_id = client_id if client_id is not None else os.environ.get("TWITCH_CLIENT_ID", "")
        self.secret = secret if secret is not None else os.environ.get("TWITCH_CLIENT_SECRET", "")
        self.http = http or httpx.Client(timeout=10)
        self._token, self._token_until = "", 0.0
        self._users: dict[str, tuple[float, dict | None]] = {}
        self._ids: dict[str, str] = {}
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.secret)

    def _auth(self) -> dict:
        with self._lock:
            if time.time() > self._token_until - 60:
                r = self.http.post("https://id.twitch.tv/oauth2/token", params={
                    "client_id": self.client_id, "client_secret": self.secret, "grant_type": "client_credentials"})
                r.raise_for_status()
                d = r.json()
                self._token, self._token_until = d["access_token"], time.time() + d.get("expires_in", 3600)
        return {"Client-Id": self.client_id, "Authorization": f"Bearer {self._token}"}

    def _get(self, path: str, params) -> list[dict]:
        if not self.enabled:
            return []
        try:
            r = self.http.get(HELIX + path, params=params, headers=self._auth())
            if r.status_code == 401:  # токен отозван: берём новый и пробуем ещё раз
                self._token_until = 0
                r = self.http.get(HELIX + path, params=params, headers=self._auth())
            r.raise_for_status()
            return r.json().get("data", [])
        except (httpx.HTTPError, ValueError, KeyError) as e:
            log.warning("Twitch API %s: %s", path, e)
            return []

    def search(self, query: str, limit: int = 10) -> list[dict]:
        """Стримеры по началу ника, сначала те, кто сейчас в эфире."""
        rows = self._get("/search/channels", {"query": query, "first": limit})
        out = [{"platform": "twitch", "name": r["broadcaster_login"], "title": r.get("display_name") or r["broadcaster_login"],
                "avatar": r.get("thumbnail_url"), "live": bool(r.get("is_live")), "game": r.get("game_name") or None}
               for r in rows]
        out.sort(key=lambda x: not x["live"])
        return out

    def users(self, logins: list[str]) -> dict[str, dict]:
        """Профили (аватарка, имя) по никам. Кэш на сутки, чтобы не тратить лимиты API."""
        now = time.time()
        logins = [x.lower() for x in logins]
        if not self.enabled:
            return {}
        need = [x for x in logins if x not in self._users or self._users[x][0] < now - 86400]
        for i in range(0, len(need), 100):
            part = need[i:i + 100]
            found = {r["login"]: r for r in self._get("/users", [("login", x) for x in part])}
            for x in part:
                r = found.get(x)
                self._users[x] = (now, {"id": r["id"], "title": r["display_name"],
                                        "avatar": r["profile_image_url"]} if r else None)
                if r:
                    self._ids[x] = r["id"]
        return {x: self._users[x][1] for x in logins if x in self._users and self._users[x][1]}

    def avatar(self, login: str) -> str | None:
        u = self.users([login]).get(login.lower())
        return u["avatar"] if u else None

    def recent_clips(self, login: str, since: float) -> int:
        """Сколько клипов зрители сами сделали на канале после момента since."""
        uid = self._ids.get(login.lower()) or (self.users([login]).get(login.lower()) or {}).get("id")
        if not uid:
            return 0
        start = datetime.fromtimestamp(since, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return len(self._get("/clips", {"broadcaster_id": uid, "started_at": start, "first": 50}))


# Популярные стримеры для быстрого старта (можно поменять список в любой момент)
POPULAR: list[tuple[str, str]] = [
    ("twitch", "buster"), ("twitch", "evelone2004"), ("twitch", "mokrivskyi"), ("twitch", "exileshow"),
    ("twitch", "kaicenat"), ("twitch", "ibai"), ("twitch", "xqc"), ("twitch", "jynxzi"),
    ("kick", "adinross"), ("kick", "xqc"), ("youtube", "@MrBeast"), ("youtube", "@IShowSpeed"),
]
