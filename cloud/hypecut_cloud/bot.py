"""Общий бот HypeCut: привязка аккаунта по ссылке из приложения и управление каналами."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from .config import Config
from .db import DB, normalize_channel
from .sources import from_key
from .plans import PLANS
from .telegram_api import TelegramAPI

log = logging.getLogger(__name__)

HELP = (
    "Я HypeCut. Я сам смотрю стримы, нахожу самые яркие моменты и присылаю готовые клипы сюда.\n\n"
    "Пришли ссылку на канал, и я начну следить. Подходят Twitch, YouTube, Kick, VK Видео и TikTok, например:\n"
    "twitch.tv/имя\nyoutube.com/@имя\nkick.com/имя\nlive.vkvideo.ru/имя\ntiktok.com/@имя\n"
    "Просто ник без ссылки я ищу на Twitch.\n\n"
    "/list — мои каналы\n"
    "/remove имя — перестать следить\n"
    "/plan — мой тариф\n"
    "/help — помощь"
)

FOLLOW_TEXT = {
    "ok": "Готово, слежу за {ch}. Как только начнётся стрим, клипы придут сюда.",
    "exists": "Ты уже следишь за {ch}.",
    "limit": "На твоём тарифе можно следить за {n} каналами. Убери один через /remove или повысь тариф в приложении.",
    "blocked": "Стример {ch} попросил не нарезать его канал. Выбери другой.",
    "no_plan": "Пробный период закончился. Оформи подписку в приложении HypeCut, и клипы снова будут приходить.",
}


def pretty(key: str) -> str:
    """«youtube:@nightowl» -> «nightowl (YouTube)»."""
    src = from_key(key)
    return f"{src.name.lstrip('@')} ({src.title})"


class Bot:
    def __init__(self, cfg: Config, db: DB, api: TelegramAPI):
        self.cfg, self.db, self.api = cfg, db, api
        self.on_change = None  # вызывается, когда список каналов поменялся

    def _app_buttons(self) -> list[list[dict]] | None:
        return [[{"text": "Открыть приложение HypeCut", "url": self.cfg.app_url}]] if self.cfg.app_url else None

    async def handle(self, update: dict) -> None:
        msg = update.get("message") or {}
        chat = msg.get("chat") or {}
        text = (msg.get("text") or "").strip()
        if chat.get("type") != "private" or not text:
            return
        chat_id = chat["id"]
        username = (msg.get("from") or {}).get("username")
        cmd, _, arg = text.partition(" ")
        cmd = cmd.split("@")[0].lower()
        arg = arg.strip()

        if cmd == "/start":
            await self._start(chat_id, username, arg)
            return

        user = self.db.user_by_chat(chat_id)
        if user is None:
            # человек пишет боту без приложения: создаём аккаунт по Telegram, с пробным периодом
            user = self.db.upsert_user("telegram", str(chat_id), name=username)
            self.db.x("UPDATE users SET telegram_chat_id=?, telegram_username=? WHERE id=?",
                      (chat_id, username, user["id"]))
            user = self.db.user(user["id"])

        if cmd in ("/help", "/menu"):
            await self.api.send_message(chat_id, HELP, self._app_buttons())
        elif cmd == "/list":
            chans = self.db.follows(user["id"])
            text = ("Твои каналы:\n" + "\n".join(f"• {pretty(c)}" for c in chans)) if chans else \
                "Ты пока ни за кем не следишь. Пришли ник стримера."
            await self.api.send_message(chat_id, text)
        elif cmd == "/remove":
            ch = normalize_channel(arg)
            if ch and self.db.unfollow(user["id"], ch):
                await self.api.send_message(chat_id, f"Больше не слежу за {pretty(ch)}.")
                self._changed()
            else:
                await self.api.send_message(chat_id, "Напиши так: /remove ссылка_на_канал (список: /list)")
        elif cmd == "/plan":
            await self.api.send_message(chat_id, self._plan_text(user), self._app_buttons())
        elif cmd == "/add" or not cmd.startswith("/"):
            ch = normalize_channel(arg if cmd == "/add" else text)
            if not ch:
                await self.api.send_message(chat_id, "Не понял канал. Пришли ссылку, например twitch.tv/имя или youtube.com/@имя.")
                return
            res = self.db.follow(user["id"], ch)
            plan = self.db.plan_of(user)
            await self.api.send_message(chat_id, FOLLOW_TEXT[res].format(ch=pretty(ch), n=plan.channels if plan else 0),
                                        self._app_buttons() if res in ("limit", "no_plan") else None)
            if res == "ok":
                self._changed()
        else:
            await self.api.send_message(chat_id, HELP)

    async def _start(self, chat_id: int, username: str | None, token: str) -> None:
        if token:
            user = self.db.use_link_token(token, chat_id, username)
            if user is None:
                await self.api.send_message(chat_id, "Ссылка устарела. Открой приложение HypeCut и нажми «Подключить Telegram» ещё раз.")
                return
            chans = self.db.follows(user["id"])
            tail = f"Слежу за: {', '.join(pretty(c) for c in chans)}." if chans else "Добавь каналы в приложении или пришли ник стримера сюда."
            await self.api.send_message(chat_id, f"Готово! Аккаунт HypeCut подключён. Клипы будут приходить сюда.\n{tail}")
            self._changed()
            return
        if self.db.user_by_chat(chat_id) is None:
            user = self.db.upsert_user("telegram", str(chat_id), name=username)
            self.db.x("UPDATE users SET telegram_chat_id=?, telegram_username=? WHERE id=?",
                      (chat_id, username, user["id"]))
        await self.api.send_message(chat_id, HELP, self._app_buttons())

    def _plan_text(self, user) -> str:
        plan = self.db.plan_of(user)
        if plan is None:
            return "Подписки нет. Оформи её в приложении HypeCut."
        until = user["plan_until"] if plan.id != "trial" else user["trial_until"]
        limit = "без лимита" if plan.clips_per_stream is None else f"до {plan.clips_per_stream}"
        return (f"Тариф: {plan.title}\nДо: {datetime.fromtimestamp(until):%d.%m.%Y}\n"
                f"Каналов: {plan.channels}\nКлипов за стрим: {limit}")

    def _changed(self) -> None:
        if self.on_change:
            self.on_change()

    async def run(self) -> None:
        """Получение сообщений (long polling). Вебхук не нужен, работает за любым NAT."""
        offset = 0
        while True:
            try:
                for upd in await self.api.get_updates(offset):
                    offset = max(offset, upd["update_id"] + 1)
                    try:
                        await self.handle(upd)
                    except Exception:
                        log.exception("Ошибка обработки сообщения")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("Telegram недоступен: %s", e)
                await asyncio.sleep(5)


__all__ = ["Bot", "PLANS"]
