"""Общий бот HypeCut: привязка аккаунта по ссылке из приложения и управление каналами."""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime

from .config import Config
from .db import DB, lang_of, normalize_channel
from .sources import from_key
from .plans import PAID, PLANS
from .telegram_api import TelegramAPI

log = logging.getLogger(__name__)

HELP_RU = (
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
HELP_EN = (
    "I'm HypeCut. I watch streams for you, find the best moments and send ready clips here.\n\n"
    "Send me a channel link and I'll start watching. Twitch, YouTube, Kick, VK Video and TikTok work, for example:\n"
    "twitch.tv/name\nyoutube.com/@name\nkick.com/name\nlive.vkvideo.ru/name\ntiktok.com/@name\n"
    "A plain name without a link is looked up on Twitch.\n\n"
    "/list — my channels\n"
    "/remove name — stop watching\n"
    "/plan — my plan\n"
    "/buy — pay with Telegram Stars\n"
    "/help — help"
)
HELP = HELP_RU

FOLLOW_TEXT = {
    "ok": ("Готово, слежу за {ch}. Как только начнётся стрим, клипы придут сюда.",
           "Done, watching {ch}. Clips will come here as soon as the stream starts."),
    "exists": ("Ты уже следишь за {ch}.", "You already follow {ch}."),
    "limit": ("На твоём тарифе можно следить за {n} каналами. Убери один через /remove или повысь тариф: /buy",
              "Your plan allows {n} channels. Remove one with /remove or upgrade: /buy"),
    "blocked": ("Стример {ch} попросил не нарезать его канал. Выбери другой.",
                "{ch} asked not to be clipped. Please pick another channel."),
    "no_plan": ("Пробный период закончился. Оформи подписку: /buy, и клипы снова будут приходить.",
                "Your trial has ended. Subscribe with /buy to keep getting clips."),
}


def pretty(key: str) -> str:
    """«youtube:@nightowl» -> «nightowl (YouTube)»."""
    src = from_key(key)
    return f"{src.name.lstrip('@')} ({src.title})"


class Bot:
    def __init__(self, cfg: Config, db: DB, api: TelegramAPI):
        self.cfg, self.db, self.api = cfg, db, api
        self.on_change = None  # вызывается, когда список каналов поменялся
        self.en = False  # язык текущего собеседника (сообщения обрабатываются по одному)

    def t(self, ru: str, en: str) -> str:
        return en if self.en else ru

    @property
    def help(self) -> str:
        return self.t(HELP_RU, HELP_EN)

    def _app_buttons(self) -> list[list[dict]] | None:
        return [[{"text": self.t("Открыть приложение HypeCut", "Open the HypeCut app"), "url": self.cfg.app_url}]] \
            if self.cfg.app_url else None

    async def handle(self, update: dict) -> None:
        if "pre_checkout_query" in update:
            await self._pre_checkout(update["pre_checkout_query"])
            return
        msg = update.get("message") or {}
        code = (msg.get("from") or {}).get("language_code")
        self.en = lang_of(code) == "en" if code else False
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
            if code and (u := self.db.user_by_chat(chat_id)):
                self.db.set_lang(u["id"], code)
            return

        user = self.db.user_by_chat(chat_id)
        if user is None:
            # человек пишет боту без приложения: создаём аккаунт по Telegram, с пробным периодом
            user = self.db.upsert_user("telegram", str(chat_id), name=username)
            self.db.x("UPDATE users SET telegram_chat_id=?, telegram_username=? WHERE id=?",
                      (chat_id, username, user["id"]))
            user = self.db.user(user["id"])
        if code and user["lang"] != lang_of(code):
            self.db.set_lang(user["id"], code)

        if cmd in ("/help", "/menu"):
            await self.api.send_message(chat_id, self.help, self._app_buttons())
        elif cmd == "/list":
            chans = self.db.follows(user["id"])
            text = (self.t("Твои каналы:\n", "Your channels:\n") + "\n".join(f"• {pretty(c)}" for c in chans)) if chans else \
                self.t("Ты пока ни за кем не следишь. Пришли ник стримера.", "You don't follow anyone yet. Send a streamer's name.")
            await self.api.send_message(chat_id, text)
        elif cmd == "/remove":
            ch = normalize_channel(arg)
            if ch and self.db.unfollow(user["id"], ch):
                await self.api.send_message(chat_id, self.t("Больше не слежу за {}.", "Stopped watching {}.").format(pretty(ch)))
                self._changed()
            else:
                await self.api.send_message(chat_id, self.t("Напиши так: /remove ссылка_на_канал (список: /list)", "Use: /remove channel_link (see /list)"))
        elif cmd == "/plan":
            await self.api.send_message(chat_id, self._plan_text(user) + self.t("\n\nПродлить или повысить тариф: /buy", "\n\nRenew or upgrade: /buy"),
                                        self._app_buttons())
        elif cmd in ("/buy", "/subscribe"):
            await self._offer(chat_id, user)
        elif cmd == "/add" or not cmd.startswith("/"):
            ch = normalize_channel(arg if cmd == "/add" else text)
            if not ch:
                await self.api.send_message(chat_id, self.t("Не понял канал. Пришли ссылку, например twitch.tv/имя или youtube.com/@имя.", "I didn't get the channel. Send a link like twitch.tv/name or youtube.com/@name."))
                return
            res = self.db.follow(user["id"], ch)
            plan = self.db.plan_of(user)
            await self.api.send_message(chat_id, self.t(*FOLLOW_TEXT[res]).format(ch=pretty(ch), n=plan.channels if plan else 0),
                                        self._app_buttons() if res in ("limit", "no_plan") else None)
            if res == "ok":
                self._changed()
        else:
            await self.api.send_message(chat_id, self.help)

    async def _start(self, chat_id: int, username: str | None, token: str) -> None:
        if token:
            user = self.db.use_link_token(token, chat_id, username)
            if user is None:
                await self.api.send_message(chat_id, self.t("Ссылка устарела. Открой приложение HypeCut и нажми «Подключить Telegram» ещё раз.", "This link has expired. Open the HypeCut app and tap “Connect Telegram” again."))
                return
            chans = self.db.follows(user["id"])
            tail = self.t("Слежу за: ", "Watching: ") + ", ".join(pretty(c) for c in chans) + "." if chans else \
                self.t("Добавь каналы в приложении или пришли ник стримера сюда.", "Add channels in the app or send a streamer's name here.")
            await self.api.send_message(chat_id, self.t("Готово! Аккаунт HypeCut подключён. Клипы будут приходить сюда.", "Done! Your HypeCut account is connected. Clips will come here.") + f"\n{tail}")
            self._changed()
            return
        if self.db.user_by_chat(chat_id) is None:
            user = self.db.upsert_user("telegram", str(chat_id), name=username)
            self.db.x("UPDATE users SET telegram_chat_id=?, telegram_username=? WHERE id=?",
                      (chat_id, username, user["id"]))
        await self.api.send_message(chat_id, self.help, self._app_buttons())

    # ---------- оплата звёздами Telegram ----------
    async def _offer(self, chat_id: int, user) -> None:
        buttons = []
        for plan in (PLANS["standard"], PLANS["pro"], PLANS["max"]):
            link = await self.api.create_subscription_link(
                f"HypeCut {plan.title}",
                f"{plan.channels} " + self.t("каналов, ", "channels, ") + (
                    self.t("клипы без лимита", "unlimited clips") if plan.clips_per_stream is None
                    else self.t(f"до {plan.clips_per_stream} клипов за стрим", f"up to {plan.clips_per_stream} clips per stream"))
                + self.t(", 30 дней", ", 30 days"),
                f"plan:{plan.id}:{user['id']}", plan.stars)
            if link:
                buttons.append([{"text": f"{plan.title} · {plan.stars} ⭐ " + self.t("в месяц", "per month"), "url": link}])
        if not buttons:
            await self.api.send_message(chat_id, self.t("Оплата сейчас недоступна, попробуй позже.", "Payments are unavailable right now, try later."))
            return
        await self.api.send_message(
            chat_id,
            self.t(
                "Подписка HypeCut оплачивается звёздами Telegram и продлевается сама каждые 30 дней. "
                "Отменить можно в любой момент в настройках Telegram.\n\n"
                f"Standard: 720p, {PLANS['standard'].channels} канала, до {PLANS['standard'].clips_per_stream} клипов за стрим, "
                "вертикальные клипы с субтитрами\n"
                f"Pro: 1080p, {PLANS['pro'].channels} каналов, до {PLANS['pro'].clips_per_stream} клипов за стрим, первыми в очереди\n"
                f"Max: до 2K, {PLANS['max'].channels} каналов, до {PLANS['max'].clips_per_stream} клипов за стрим, клипы длиннее",
                "HypeCut is paid with Telegram Stars and renews every 30 days. Cancel any time in Telegram settings.\n\n"
                f"Standard: 720p, {PLANS['standard'].channels} channels, up to {PLANS['standard'].clips_per_stream} clips per stream, "
                "vertical clips with captions\n"
                f"Pro: 1080p, {PLANS['pro'].channels} channels, up to {PLANS['pro'].clips_per_stream} clips per stream, priority\n"
                f"Max: up to 2K, {PLANS['max'].channels} channels, up to {PLANS['max'].clips_per_stream} clips per stream, longer clips"),
            buttons)

    @staticmethod
    def _parse_payload(payload: str) -> tuple[str, int] | None:
        parts = (payload or "").split(":")
        if len(parts) != 3 or parts[0] != "plan" or parts[1] not in PAID:
            return None
        try:
            return parts[1], int(parts[2])
        except ValueError:
            return None

    async def _pre_checkout(self, q: dict) -> None:
        parsed = self._parse_payload(q.get("invoice_payload", ""))
        ok = (parsed is not None and q.get("currency") == "XTR"
              and q.get("total_amount") == PLANS[parsed[0]].stars and self.db.user(parsed[1]) is not None)
        await self.api.answer_pre_checkout(q["id"], ok, None if ok else self.t("Счёт устарел, нажми /buy ещё раз.", "This invoice expired, tap /buy again."))

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
        renewed = pay.get("is_recurring") and not pay.get("is_first_recurring")
        what = self.t("продлена" if renewed else "оформлена", "renewed" if renewed else "active")
        await self.api.send_message(chat_id, self.t("Спасибо! Подписка {} {} до {}.", "Thank you! {} plan {} until {}.").format(
            PLANS[plan_id].title, what, f"{datetime.fromtimestamp(until):%d.%m.%Y}"))

    def _plan_text(self, user) -> str:
        plan = self.db.plan_of(user)
        if plan is None:
            return self.t("Подписки нет. Оформи её через /buy или в приложении HypeCut.", "No subscription. Get one with /buy or in the HypeCut app.")
        until = user["plan_until"] if plan.id != "trial" else user["trial_until"]
        limit = self.t("без лимита", "unlimited") if plan.clips_per_stream is None else str(plan.clips_per_stream)
        return self.t("Тариф: {}\nДо: {}\nКаналов: {}\nКлипов за стрим: {}",
                      "Plan: {}\nUntil: {}\nChannels: {}\nClips per stream: {}").format(
            plan.title, f"{datetime.fromtimestamp(until):%d.%m.%Y}", plan.channels, limit)

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
