"""Встречи и вебинары: вход в Zoom / Google / Microsoft и записи оттуда.

Чтобы сервис заработал, владелец регистрирует приложение у Zoom, Google или Microsoft и кладёт
ключи в .env (ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET, GOOGLE_OAUTH_CLIENT_ID / ..._SECRET,
MS_CLIENT_ID / MS_CLIENT_SECRET). Без ключей кнопка «Подключить» честно говорит, что сервис ещё не настроен.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode

import httpx


@dataclass(frozen=True)
class Service:
    id: str
    title: str
    authorize: str
    token: str
    scope: str
    env: str                 # префикс переменных окружения с ключами

    @property
    def client_id(self) -> str:
        return os.environ.get(f"{self.env}_CLIENT_ID", "")

    @property
    def client_secret(self) -> str:
        return os.environ.get(f"{self.env}_CLIENT_SECRET", "")

    @property
    def ready(self) -> bool:
        return bool(self.client_id and self.client_secret)


SERVICES: dict[str, Service] = {
    "zoom": Service("zoom", "Zoom", "https://zoom.us/oauth/authorize", "https://zoom.us/oauth/token",
                    "cloud_recording:read:list_user_recordings cloud_recording:read:recording", "ZOOM"),
    "meet": Service("meet", "Google Meet", "https://accounts.google.com/o/oauth2/v2/auth",
                    "https://oauth2.googleapis.com/token",
                    "https://www.googleapis.com/auth/drive.readonly openid email", "GOOGLE_OAUTH"),
    "teams": Service("teams", "Microsoft Teams", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
                     "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                     "offline_access Files.Read OnlineMeetingRecording.Read.All User.Read", "MS"),
}


class MeetingError(Exception):
    pass


def auth_url(s: Service, state: str, redirect: str) -> str:
    q = {"response_type": "code", "client_id": s.client_id, "redirect_uri": redirect, "state": state, "scope": s.scope}
    if s.id == "meet":
        q |= {"access_type": "offline", "prompt": "consent"}
    return f"{s.authorize}?{urlencode(q)}"


def exchange(s: Service, code: str, redirect: str) -> dict:
    """Код со страницы входа -> токены. {"access", "refresh", "expires"}"""
    r = httpx.post(s.token, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect,
                                  "client_id": s.client_id, "client_secret": s.client_secret}, timeout=20)
    if r.status_code != 200:
        raise MeetingError(f"{s.title} не пустил: {r.status_code}")
    d = r.json()
    return {"access": d["access_token"], "refresh": d.get("refresh_token"), "expires": time.time() + d.get("expires_in", 3600)}


def refresh(s: Service, refresh_token: str) -> dict:
    r = httpx.post(s.token, data={"grant_type": "refresh_token", "refresh_token": refresh_token,
                                  "client_id": s.client_id, "client_secret": s.client_secret}, timeout=20)
    if r.status_code != 200:
        raise MeetingError(f"Войди в {s.title} ещё раз")
    d = r.json()
    return {"access": d["access_token"], "refresh": d.get("refresh_token") or refresh_token,
            "expires": time.time() + d.get("expires_in", 3600)}


def recordings(s: Service, token: str) -> list[dict]:
    """Записи за последние 30 дней: [{id, title, duration, date, participants, url}]."""
    h = {"Authorization": f"Bearer {token}"}
    if s.id == "zoom":
        since = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 30 * 86400))
        r = httpx.get("https://api.zoom.us/v2/users/me/recordings", params={"from": since, "page_size": 50}, headers=h, timeout=20)
        r.raise_for_status()
        out = []
        for m in r.json().get("meetings", []):
            mp4 = [f for f in m.get("recording_files", []) if f.get("file_type") == "MP4"]
            if mp4:
                f = max(mp4, key=lambda f: f.get("file_size", 0))
                out.append({"id": f"{m['uuid']}|{f['id']}", "title": m.get("topic") or "Zoom", "duration": m.get("duration", 0) * 60,
                            "date": _ts(m.get("start_time")), "participants": m.get("participants_count") or 0, "url": f["download_url"]})
        return out
    if s.id == "meet":
        # Google Meet кладёт записи в Google Диск, в папку «Meet Recordings»
        r = httpx.get("https://www.googleapis.com/drive/v3/files", headers=h, timeout=20, params={
            "q": "mimeType='video/mp4' and trashed=false and name contains 'Recording'", "orderBy": "createdTime desc",
            "pageSize": 30, "fields": "files(id,name,createdTime,videoMediaMetadata(durationMillis))"})
        r.raise_for_status()
        return [{"id": f["id"], "title": f["name"], "duration": int(f.get("videoMediaMetadata", {}).get("durationMillis", 0)) / 1000,
                 "date": _ts(f.get("createdTime")), "participants": 0,
                 "url": f"https://www.googleapis.com/drive/v3/files/{f['id']}?alt=media"} for f in r.json().get("files", [])]
    if s.id == "teams":
        # Teams сохраняет записи в OneDrive организатора, в папку Recordings
        r = httpx.get("https://graph.microsoft.com/v1.0/me/drive/root:/Recordings:/children", headers=h, timeout=20)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        return [{"id": f["id"], "title": f["name"], "duration": (f.get("video") or {}).get("duration", 0) / 1000,
                 "date": _ts(f.get("createdDateTime")), "participants": 0,
                 "url": f"https://graph.microsoft.com/v1.0/me/drive/items/{f['id']}/content"}
                for f in r.json().get("value", []) if f.get("file", {}).get("mimeType", "").startswith("video/")]
    return []


def download(s: Service, token: str, url: str, out: Path, max_bytes: int) -> Path:
    with httpx.stream("GET", url, headers={"Authorization": f"Bearer {token}"}, timeout=60, follow_redirects=True) as r:
        if r.status_code != 200:
            raise MeetingError(f"{s.title} не отдал запись ({r.status_code})")
        size = 0
        with out.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                size += len(chunk)
                if size > max_bytes:
                    raise MeetingError("Запись слишком большая")
                f.write(chunk)
    return out


def _ts(s: str | None) -> float:
    if not s:
        return time.time()
    try:
        return time.mktime(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except ValueError:
        return time.time()
