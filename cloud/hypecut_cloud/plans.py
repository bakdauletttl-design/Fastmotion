"""Тарифы и проверка лимитов. Чистая логика, без сети и базы.

Новые тарифы (Free, Creator, Pro, Agency, Business), пакеты часов и разовая обработка мероприятий лежат
в pricing.json: цены, часы обработки, AI-клипы и список возможностей меняются там, без правки кода и приложения.
Старые тарифы (trial, standard, max) остаются, чтобы не сломать оплаченные подписки и бота.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict, field
from pathlib import Path

TRIAL_DAYS = 3


@dataclass(frozen=True)
class Plan:
    id: str
    title: str
    price_usd: float | None   # в месяц; None = индивидуальная цена
    channels: int             # сколько каналов можно отслеживать
    clips_per_stream: int | None  # None = без лимита
    vertical: bool            # вертикальная версия для TikTok / Shorts / Reels
    priority: bool            # клипы режутся в первую очередь
    stars: int = 0            # цена в Telegram Stars за 30 дней (для оплаты прямо в боте)
    height: int = 720         # качество клипа: 720, 1080 или 1440 (2K), но не выше, чем у самого стрима
    long_clips: bool = False  # клипы длиннее: +10 секунд до момента и +5 после
    max_seconds: int = 30     # самый длинный клип, который можно вырезать кнопкой «Клип» и в монтаже
    # длинные видео (загрузка, ссылка, встречи)
    hours: float | None = 2   # часов обработки видео в месяц; None = без лимита
    ai_clips: int | None = 5  # AI-клипов из длинных видео в месяц; None = без лимита
    founder_usd: float | None = None  # цена для первых клиентов
    watermark: bool = False   # водяной знак HypeCut на клипах
    features: tuple[str, ...] = field(default_factory=tuple)
    best: bool = False
    contact: bool = False     # покупка через заявку
    app_usd: float | None = None          # цена в App Store / Google Play (выше из-за комиссии магазина)
    app_founder_usd: float | None = None

    def public(self, store: str = "app") -> dict:
        """Цены для витрины: приложению — цены магазина, сайту — свои. Другие цены наружу не отдаём."""
        d = asdict(self)
        d["features"] = list(self.features)
        app_price, app_founder = d.pop("app_usd"), d.pop("app_founder_usd")
        if store == "app":
            d["price_usd"] = app_price if app_price is not None else self.price_usd
            d["founder_usd"] = app_founder if app_founder is not None else self.founder_usd
        return d


def _pricing_path() -> Path:
    return Path(os.environ.get("HYPECUT_PRICING") or Path(__file__).with_name("pricing.json"))


def load_pricing(path: Path | None = None) -> dict:
    data = json.loads((path or _pricing_path()).read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return data


def _plan(x: dict) -> Plan:
    return Plan(id=x["id"], title=x["title"], price_usd=x.get("price_usd"), channels=int(x.get("channels", 1)),
                # клипов за один стрим (живые эфиры); ai_clips — за месяц из длинных видео
                clips_per_stream=x.get("clips_per_stream", x.get("ai_clips")), vertical=True, priority=bool(x.get("priority")),
                height=int(x.get("height", 720)), long_clips=bool(x.get("long_clips")), max_seconds=int(x.get("max_seconds", 60)),
                hours=x.get("hours"), ai_clips=x.get("ai_clips"), founder_usd=x.get("founder_usd"),
                watermark=bool(x.get("watermark")), features=tuple(x.get("features", ())),
                best=bool(x.get("best")), contact=bool(x.get("contact")), stars=int(x.get("stars", 0)),
                app_usd=x.get("app_usd"), app_founder_usd=x.get("app_founder_usd"))


PRICING = load_pricing()

# старые тарифы: у кого они оплачены, тот их и получает; бот пока продаёт их за звёзды
LEGACY: dict[str, Plan] = {
    "trial": Plan("trial", "Пробный, 3 дня", 0.0, 1, 5, False, False, height=720, max_seconds=30, hours=2, ai_clips=5),
    "standard": Plan("standard", "Standard", 10.0, 3, 20, True, False, stars=650, height=720, max_seconds=60, hours=10, ai_clips=50),
    "max": Plan("max", "Max", 50.0, 10, 100, True, True, stars=3250, height=1440, long_clips=True, max_seconds=120, hours=100, ai_clips=500),
}
CURRENT: dict[str, Plan] = {p["id"]: _plan(p) for p in PRICING["plans"]}
# старый Pro за звёзды: цена в звёздах та же, лимиты — нового Pro
if "pro" in CURRENT:
    from dataclasses import replace
    CURRENT["pro"] = replace(CURRENT["pro"], stars=1300)

PLANS: dict[str, Plan] = {**LEGACY, **CURRENT}
PAID = tuple(p for p in PLANS if p not in ("trial", "free"))


def pricing_public(store: str = "app") -> dict:
    """Всё для страницы тарифов: новые тарифы, пакеты часов, мероприятия, курс тенге.
    store="app" — цены App Store / Google Play, store="web" — цены сайта."""
    addons = []
    for a in PRICING.get("addons", []):
        a = dict(a)
        app_price = a.pop("app_usd", None)
        if store == "app" and app_price is not None:
            a["price_usd"] = app_price
        addons.append(a)
    rest = {k: v for k, v in PRICING.items() if k not in ("plans", "addons")}
    return {**rest, "store": store, "addons": addons, "plans": [p.public(store) for p in CURRENT.values()]}


def addon(addon_id: str) -> dict | None:
    return next((a for a in PRICING.get("addons", []) if a["id"] == addon_id), None)


def plan_from_product(product_id: str) -> str | None:
    """Тариф по id товара в App Store / Google Play, например hypecut_creator_monthly."""
    ids = product_id.lower()
    return next((p for p in ("agency", "creator", "max", "pro", "standard") if p in ids), None)


def effective_plan(plan: str | None, plan_until: float | None, trial_until: float | None,
                   now: float) -> Plan | None:
    """Какой тариф действует прямо сейчас. None: подписки нет, клипы со стримов не приходят."""
    if plan in PAID and plan_until and plan_until > now:
        return PLANS[plan]
    if trial_until and trial_until > now:
        return PLANS["trial"]
    return None


def long_video_plan(plan: Plan | None) -> Plan:
    """Для длинных видео без подписки действует Free."""
    return plan or PLANS["free"]


def can_follow(plan: Plan | None, current: int) -> bool:
    return plan is not None and current < plan.channels


def can_receive(plan: Plan | None, received_this_stream: int) -> bool:
    if plan is None:
        return False
    return plan.clips_per_stream is None or received_this_stream < plan.clips_per_stream
