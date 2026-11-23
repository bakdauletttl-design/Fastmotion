"""Пуш-уведомления на телефон через бесплатный сервис Expo (без своих ключей Apple/Google)."""
from __future__ import annotations

import logging

import httpx

from .db import DB

log = logging.getLogger(__name__)
EXPO_URL = "https://exp.host/--/api/v2/push/send"


class Push:
    def __init__(self, db: DB, client: httpx.AsyncClient | None = None):
        self.db = db
        self.client = client or httpx.AsyncClient(timeout=15)

    async def send(self, uids: list[int], title: str, body: str, data: dict | None = None) -> int:
        tokens = self.db.push_tokens(uids)
        sent = 0
        for i in range(0, len(tokens), 100):  # Expo принимает до 100 сообщений за раз
            batch = tokens[i:i + 100]
            msgs = [{"to": t, "title": title, "body": body, "data": data or {}, "sound": "default",
                     "channelId": "clips"} for t in batch]
            try:
                r = await self.client.post(EXPO_URL, json=msgs, headers={"Accept": "application/json"})
                tickets = r.json().get("data", [])
            except (httpx.HTTPError, ValueError) as e:
                log.warning("Expo push не ответил: %s", e)
                continue
            for token, t in zip(batch, tickets):
                if t.get("status") == "ok":
                    sent += 1
                elif (t.get("details") or {}).get("error") == "DeviceNotRegistered":
                    self.db.remove_push_token(token)  # приложение удалили
        return sent
