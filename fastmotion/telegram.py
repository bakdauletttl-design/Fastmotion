"""Отправка клипов в Telegram через Bot API."""
from __future__ import annotations

import logging
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

MAX_BYTES = 50 * 1024 * 1024  # лимит Bot API на отправку файла


class TelegramSender:
    def __init__(self, token: str, chat_id: str):
        self.token = token
        self.chat_id = chat_id

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.chat_id)

    async def send_video(self, path: Path, caption: str) -> bool:
        if not self.enabled:
            return False
        url = f"https://api.telegram.org/bot{self.token}"
        async with httpx.AsyncClient(timeout=120) as client:
            if path.stat().st_size > MAX_BYTES:
                await client.post(f"{url}/sendMessage", data={
                    "chat_id": self.chat_id,
                    "text": caption + "\n(файл больше 50 МБ, смотрите в веб-интерфейсе)"})
                return False
            with path.open("rb") as f:
                r = await client.post(f"{url}/sendVideo", data={
                    "chat_id": self.chat_id, "caption": caption,
                    "supports_streaming": "true",
                }, files={"video": (path.name, f, "video/mp4")})
        if r.status_code != 200:
            log.warning("Telegram ответил %s: %s", r.status_code, r.text[:300])
            return False
        return True
