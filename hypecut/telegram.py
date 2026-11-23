"""Отправка клипов в Telegram через Bot API."""
from __future__ import annotations

import logging
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

MAX_BYTES = 50 * 1024 * 1024  # лимит Bot API на отправку файла
API = "https://api.telegram.org/bot{token}/{method}"


class TelegramSender:
    def __init__(self, token: str, chat_id: str):
        self.token = token
        self.chat_id = chat_id

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.chat_id)

    def _url(self, method: str) -> str:
        return API.format(token=self.token, method=method)

    async def send_text(self, text: str) -> tuple[bool, str]:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(self._url("sendMessage"), data={"chat_id": self.chat_id, "text": text})
        data = r.json()
        return bool(data.get("ok")), data.get("description", "")

    async def send_video(self, path: Path, caption: str) -> bool:
        if not self.enabled:
            return False
        async with httpx.AsyncClient(timeout=120) as client:
            if path.stat().st_size > MAX_BYTES:
                await client.post(self._url("sendMessage"), data={
                    "chat_id": self.chat_id,
                    "text": caption + "\n(файл больше 50 МБ, смотрите в программе)"})
                return False
            with path.open("rb") as f:
                r = await client.post(self._url("sendVideo"), data={
                    "chat_id": self.chat_id, "caption": caption,
                    "supports_streaming": "true",
                }, files={"video": (path.name, f, "video/mp4")})
        if r.status_code != 200:
            log.warning("Telegram ответил %s: %s", r.status_code, r.text[:300])
            return False
        return True


async def find_chat(token: str) -> dict:
    """Ищет чат, из которого последним писали боту. Так пользователю не нужно знать свой id."""
    async with httpx.AsyncClient(timeout=30) as client:
        me = (await client.get(API.format(token=token, method="getMe"))).json()
        if not me.get("ok"):
            return {"ok": False, "error": "Токен не подошёл. Скопируйте его из @BotFather целиком."}
        upd = (await client.get(API.format(token=token, method="getUpdates"))).json()
    bot = me["result"].get("username", "")
    for u in reversed(upd.get("result", [])):
        msg = u.get("message") or u.get("channel_post") or u.get("my_chat_member") or {}
        chat = msg.get("chat")
        if chat:
            name = chat.get("title") or chat.get("first_name") or chat.get("username") or ""
            return {"ok": True, "chat_id": str(chat["id"]), "name": name, "bot": bot}
    return {"ok": False, "bot": bot,
            "error": f"Напишите боту @{bot} любое сообщение в Telegram и нажмите кнопку ещё раз."}
