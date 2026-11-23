"""Тарифы и проверка лимитов. Чистая логика, без сети и базы."""
from __future__ import annotations

from dataclasses import dataclass, asdict

TRIAL_DAYS = 7


@dataclass(frozen=True)
class Plan:
    id: str
    title: str
    price_usd: float          # в месяц
    channels: int             # сколько каналов можно отслеживать
    clips_per_stream: int | None  # None = без лимита
    vertical: bool            # вертикальная версия для TikTok / Shorts / Reels
    priority: bool            # клипы режутся в первую очередь
    stars: int = 0            # цена в Telegram Stars за 30 дней (для оплаты прямо в боте)
    height: int = 720         # качество клипа: 720, 1080 или 1440 (2K), но не выше, чем у самого стрима
    long_clips: bool = False  # клипы длиннее: +10 секунд до момента и +5 после

    def public(self) -> dict:
        return asdict(self)


PLANS: dict[str, Plan] = {
    "trial": Plan("trial", "Пробный, 7 дней", 0.0, 1, 5, False, False, height=720),
    "standard": Plan("standard", "Standard", 9.99, 3, 20, True, False, stars=650, height=720),
    "pro": Plan("pro", "Pro", 19.99, 6, 100, True, True, stars=1300, height=1080),
    "max": Plan("max", "Max", 49.99, 10, 200, True, True, stars=3250, height=1440, long_clips=True),
}


PAID = ("standard", "pro", "max")


def plan_from_product(product_id: str) -> str | None:
    """Тариф по id товара в App Store / Google Play, например hypecut_max_monthly."""
    ids = product_id.lower()
    return next((p for p in ("max", "pro", "standard") if p in ids), None)


def effective_plan(plan: str | None, plan_until: float | None, trial_until: float | None,
                   now: float) -> Plan | None:
    """Какой тариф действует прямо сейчас. None: подписки нет, клипы не приходят."""
    if plan in PAID and plan_until and plan_until > now:
        return PLANS[plan]
    if trial_until and trial_until > now:
        return PLANS["trial"]
    return None


def can_follow(plan: Plan | None, current: int) -> bool:
    return plan is not None and current < plan.channels


def can_receive(plan: Plan | None, received_this_stream: int) -> bool:
    if plan is None:
        return False
    return plan.clips_per_stream is None or received_this_stream < plan.clips_per_stream
