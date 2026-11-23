"""Общий бот HypeCut: привязка аккаунта по ссылке из приложения и управление каналами."""
from __future__ import annotations

import asyncio
import logging
import time
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
    "/buy — оплатить подписку звёздами Telegram\n"
    "/help — помощь"
)

FOLLOW_TEXT = {
    "ok": "Готово, слежу за {ch}. Как только начнётся стрим, клипы придут сюда.",
    "exists": "Ты уже следишь за {ch}.",
    "limit": "На твоём тарифе можно следить за {n} каналами. Убери один через /remove или повысь тариф: /buy",
    "blocked": "Стример {ch} попросил не нарезать его канал. Выбери другой.",
    "no_plan": "Пробный период закончился. Оформи подписку: /buy, и клипы снова будут приходить.",
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
        if "pre_checkout_query" in update:
            await self._pre_checkout(update["pre_checkout_query"])
            return
        msg = update.get("message") or {}
        if msg.get("successful_payment"):
            await self._paid(msg["chat"]["id"], msg["successful_payment"])
            return
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
            await self.api.send_message(chat_id, self._plan_text(user) + "\n\nПродлить или повысить тариф: /buy",
                                        self._app_buttons())
        elif cmd in ("/buy", "/subscribe"):
            await self._offer(chat_id, user)
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

    # ---------- оплата звёздами Telegram ----------
    async def _offer(self, chat_id: int, user) -> None:
        buttons = []
        for plan in (PLANS["standard"], PLANS["pro"]):
            link = await self.api.create_subscription_link(
                f"HypeCut {plan.title}",
                f"{plan.channels} каналов, " + ("клипы без лимита" if plan.clips_per_stream is None
                                                else f"до {plan.clips_per_stream} клипов за стрим") + ", 30 дней",
                f"plan:{plan.id}:{user['id']}", plan.stars)
            if link:
                buttons.append([{"text": f"{plan.title} · {plan.stars} ⭐ в месяц", "url": link}])
        if not buttons:
            await self.api.send_message(chat_id, "Оплата сейчас недоступна, попробуй позже.")
            return
        await self.api.send_message(
            chat_id,
            "Подписка HypeCut оплачивается звёздами Telegram и продлевается сама каждые 30 дней. "
            "Отменить можно в любой момент в настройках Telegram.\n\n"
            f"Standard: {PLANS['standard'].channels} канала, до {PLANS['standard'].clips_per_stream} клипов за стрим, вертикальные клипы\n"
            f"Pro: {PLANS['pro'].channels} каналов, клипы без лимита, первыми в очереди",
            buttons)

    @staticmethod
    def _parse_payload(payload: str) -> tuple[str, int] | None:
        parts = (payload or "").split(":")
        if len(parts) != 3 or parts[0] != "plan" or parts[1] not in ("standard", "pro"):
            return None
        try:
            return parts[1], int(parts[2])
        except ValueError:
            return None

    async def _pre_checkout(self, q: dict) -> None:
        parsed = self._parse_payload(q.get("invoice_payload", ""))
        ok = (parsed is not None and q.get("currency") == "XTR"
              and q.get("total_amount") == PLANS[parsed[0]].stars and self.db.user(parsed[1]) is not None)
        await self.api.answer_pre_checkout(q["id"], ok, None if ok else "Счёт устарел, нажми /buy ещё раз.")

    async def _paid(self, chat_id: int, pay: dict) -> None:
        parsed = self._parse_payload(pay.get("invoice_payload", ""))
        if parsed is None or pay.get("currency") != "XTR":
            return
        plan_id, uid = parsed
        if self.db.user(uid) is None:
            return
        until = pay.get("subscription_expiration_date") or (time.time() + 30 * 86400)
        self.db.set_plan(uid, plan_id, float(until))
        self.db.x("INSERT INTO payments (user_id, plan, stars, charge_id, created) VALUES (?,?,?,?,?)",
                  (uid, plan_id, pay.get("total_amount", 0), pay.get("telegram_payment_charge_id"), time.time()))
        self._changed()
        what = "продлена" if pay.get("is_recurring") and not pay.get("is_first_recurring") else "оформлена"
        await self.api.send_message(chat_id, f"Спасибо! Подписка {PLANS[plan_id].title} {what} до "
                                             f"{datetime.fromtimestamp(until):%d.%m.%Y}.")

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
