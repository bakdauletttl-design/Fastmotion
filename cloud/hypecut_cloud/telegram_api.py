"""Небольшой клиент Telegram Bot API для общего бота HypeCut."""
from __future__ import annotations

import logging
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

MAX_BYTES = 50 * 1024 * 1024  # лимит Bot API на загрузку файла


class TelegramAPI:
    def __init__(self, token: str, base: str = "https://api.telegram.org"):
        self.token = token
        self.base = base
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15))

    def _url(self, method: str) -> str:
        return f"{self.base}/bot{self.token}/{method}"

    async def call(self, method: str, data: dict | None = None, files: dict | None = None) -> dict:
        r = await self.client.post(self._url(method), data=data, files=files)
        try:
            body = r.json()
        except ValueError:
            body = {"ok": False, "description": r.text[:200]}
        if not body.get("ok"):
            log.warning("Telegram %s: %s", method, body.get("description"))
        return body

    async def get_updates(self, offset: int, timeout: int = 50) -> list[dict]:
        r = await self.client.post(self._url("getUpdates"),
                                   json={"offset": offset, "timeout": timeout,
                                         "allowed_updates": ["message"]},
                                   timeout=timeout + 15)
        body = r.json()
        return body.get("result", []) if body.get("ok") else []

    async def send_message(self, chat_id: int, text: str, buttons: list[list[dict]] | None = None) -> bool:
        import json
        data = {"chat_id": chat_id, "text": text, "disable_web_page_preview": "true"}
        if buttons:
            data["reply_markup"] = json.dumps({"inline_keyboard": buttons})
        return bool((await self.call("sendMessage", data)).get("ok"))

    async def send_video(self, chat_id: int, caption: str, path: Path | None = None,
                         file_id: str | None = None) -> tuple[bool, str | None]:
        """Отправляет клип. Возвращает (успех, file_id). По file_id Telegram не загружает файл снова,
        поэтому один клип для 1000 подписчиков загружается на сервера Telegram только один раз."""
        data = {"chat_id": chat_id, "caption": caption, "supports_streaming": "true"}
        if file_id:
            body = await self.call("sendVideo", {**data, "video": file_id})
        else:
            if path is None or not path.exists():
                return False, None
            if path.stat().st_size > MAX_BYTES:
                await self.send_message(chat_id, caption + "\n(клип больше 50 МБ, он есть в приложении)")
                return False, None
            with path.open("rb") as f:
                body = await self.call("sendVideo", data, files={"video": (path.name, f, "video/mp4")})
        if not body.get("ok"):
            return False, None
        video = body["result"].get("video") or body["result"].get("document") or {}
        return True, video.get("file_id")

    async def close(self) -> None:
        await self.client.aclose()
