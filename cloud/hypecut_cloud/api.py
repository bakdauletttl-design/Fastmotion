"""HTTP API для мобильного приложения."""
from __future__ import annotations

import json
import time
from typing import Callable

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from pathlib import Path

from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import auth, variants
from .config import Config
from .db import DB, normalize_channel
from .plans import PLANS, plan_from_product
from .sources import PLATFORMS, from_key
from .twitch import POPULAR, Twitch


class GoogleIn(BaseModel):
    id_token: str


class AppleIn(BaseModel):
    identity_token: str
    name: str | None = None


class DevIn(BaseModel):
    name: str = "tester"


EN = {
    "На этом тарифе больше каналов нельзя": "Your plan does not allow more channels",
    "Стример попросил не нарезать этот канал": "This streamer asked not to be clipped",
    "Нужна подписка": "A subscription is required",
    "Не похоже на канал. Пример: twitch.tv/имя или youtube.com/@имя":
        "That does not look like a channel. Example: twitch.tv/name or youtube.com/@name",
    "Неверный токен уведомлений": "Invalid notification token",
    "Аккаунт не найден": "Account not found",
    "Нужно войти": "Please sign in",
    "Клип не найден": "Clip not found",
    "Файл уже удалён с сервера, он есть в Telegram": "The file was removed from the server; it is still in Telegram",
    "Бот ещё не настроен на сервере": "The bot is not set up on the server yet",
}


class RateIn(BaseModel):
    value: int  # 1 нравится, -1 не нравится, 0 убрать оценку


class PushIn(BaseModel):
    token: str


class ChannelIn(BaseModel):
    channel: str
    platform: str | None = None  # для ника без ссылки: twitch | youtube | kick | vk | tiktok


def create_app(cfg: Config, db: DB, on_change: Callable[[], None] = lambda: None,
               status: Callable[[str], dict] | None = None, twitch: Twitch | None = None) -> FastAPI:
    app = FastAPI(title="HypeCut Cloud", version="0.1")
    twitch = twitch or Twitch()

    def remember_lang(user, request: Request):
        db.set_lang(user["id"], request.headers.get("accept-language"))
        return db.user(user["id"])

    @app.exception_handler(HTTPException)
    async def localized(request: Request, exc: HTTPException):
        # приложение присылает язык телефона; не русским отвечаем по-английски
        detail = exc.detail
        if isinstance(detail, str) and not request.headers.get("accept-language", "ru").startswith("ru"):
            detail = EN.get(detail, detail)
        return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=exc.headers)

    def with_avatars(items: list[dict]) -> list[dict]:
        """Подставляет аватарки Twitch одним запросом на весь список."""
        names = [x["name"] for x in items if x["platform"] == "twitch"]
        users = twitch.users(names) if names else {}
        for x in items:
            u = users.get(x["name"].lower()) if x["platform"] == "twitch" else None
            x.setdefault("avatar", u["avatar"] if u else None)
            if u:
                x["display"] = u["title"]
        return items

    def current_user(authorization: str | None = Header(None), token: str | None = Query(None)):
        raw = (authorization or "").removeprefix("Bearer ").strip() or token
        if not raw:
            raise HTTPException(401, "Нужно войти")
        try:
            uid = auth.read_session(raw, cfg.jwt_secret)
        except auth.AuthError as e:
            raise HTTPException(401, str(e))
        user = db.user(uid)
        if user is None:
            raise HTTPException(401, "Аккаунт не найден")
        return user

    def session(user) -> dict:
        return {"token": auth.issue_session(user["id"], cfg.jwt_secret), "user": me_dict(user)}

    def me_dict(user) -> dict:
        plan = db.plan_of(user)
        return {
            "id": user["id"], "email": user["email"], "name": user["name"], "provider": user["provider"],
            "plan": plan.public() if plan else None,
            "plan_until": user["plan_until"] if plan and plan.id != "trial" else user["trial_until"],
            "telegram_linked": user["telegram_chat_id"] is not None,
            "telegram_username": user["telegram_username"],
            "bot_username": cfg.bot_username,
            "channels": channels_of(user["id"]),
        }

    def channels_of(uid: int) -> list[dict]:
        out = []
        for k in db.follows(uid):
            st = status(k) if status else {"live": False, "clips_recent": db.clips_since(k, time.time() - 12 * 3600)}
            out.append({**from_key(k).public(), **st})
        return with_avatars(out)

    @app.get("/platforms")
    def platforms():
        return [{"id": k, **v} for k, v in PLATFORMS.items()]

    @app.get("/search")
    def search(q: str = Query(..., min_length=2, max_length=60), platform: str = "twitch",
               user=Depends(current_user)):
        if platform == "twitch":
            return twitch.search(q.strip().lstrip("@"))
        return []

    @app.get("/popular")
    def popular():
        return with_avatars([{**from_key(f"{p}:{n}").public()} for p, n in POPULAR])

    @app.get("/health")
    def health():
        return {"ok": True, "time": time.time()}

    static = Path(__file__).parent / "static"

    @app.get("/privacy", include_in_schema=False)
    def privacy():
        return FileResponse(static / "privacy.html", media_type="text/html")

    @app.get("/terms", include_in_schema=False)
    def terms():
        return FileResponse(static / "terms.html", media_type="text/html")

    @app.get("/plans")
    def plans():
        return [p.public() for p in PLANS.values()]

    # ---------- вход ----------
    @app.post("/auth/google")
    def login_google(body: GoogleIn, request: Request):
        try:
            c = auth.verify_google(body.id_token, cfg.google_client_ids)
        except auth.AuthError as e:
            raise HTTPException(401, str(e))
        return session(remember_lang(db.upsert_user("google", c["sub"], c.get("email"), c.get("name")), request))

    @app.post("/auth/apple")
    def login_apple(body: AppleIn, request: Request):
        try:
            c = auth.verify_apple(body.identity_token, cfg.apple_bundle_ids)
        except auth.AuthError as e:
            raise HTTPException(401, str(e))
        return session(remember_lang(db.upsert_user("apple", c["sub"], c.get("email"), body.name), request))

    @app.post("/auth/dev")
    def login_dev(body: DevIn, request: Request):
        if not cfg.dev_login:
            raise HTTPException(404)
        return session(remember_lang(db.upsert_user("dev", body.name, None, body.name), request))

    # ---------- аккаунт ----------
    @app.get("/me")
    def me(user=Depends(current_user)):
        return me_dict(user)

    @app.post("/clips/{clip_id}/rate")
    def rate(clip_id: str, body: RateIn, user=Depends(current_user)):
        if not db.rate(clip_id, user["id"], body.value):
            raise HTTPException(404, "Клип не найден")
        return {"ok": True}

    @app.post("/push/token")
    def push_token(body: PushIn, user=Depends(current_user)):
        if not body.token.startswith(("ExponentPushToken[", "ExpoPushToken[")):
            raise HTTPException(400, "Неверный токен уведомлений")
        db.add_push_token(user["id"], body.token)
        return {"ok": True}

    @app.delete("/push/token")
    def push_token_off(body: PushIn, user=Depends(current_user)):
        db.remove_push_token(body.token)
        return {"ok": True}

    @app.delete("/me")
    def delete_me(user=Depends(current_user)):
        # Apple требует, чтобы аккаунт можно было удалить прямо из приложения
        db.delete_user(user["id"])
        on_change()
        return {"ok": True}

    @app.post("/telegram/link")
    def telegram_link(user=Depends(current_user)):
        if not cfg.bot_username:
            raise HTTPException(503, "Бот ещё не настроен на сервере")
        token = db.new_link_token(user["id"])
        return {"url": f"https://t.me/{cfg.bot_username}?start={token}",
                "app_url": f"tg://resolve?domain={cfg.bot_username}&start={token}"}

    # ---------- каналы ----------
    @app.get("/channels")
    def channels(user=Depends(current_user)):
        return channels_of(user["id"])

    @app.post("/channels")
    def add_channel(body: ChannelIn, user=Depends(current_user)):
        ch = normalize_channel(body.channel, body.platform)
        if not ch:
            raise HTTPException(400, "Не похоже на канал. Пример: twitch.tv/имя или youtube.com/@имя")
        res = db.follow(user["id"], ch)
        errors = {"limit": (403, "На этом тарифе больше каналов нельзя"),
                  "blocked": (403, "Стример попросил не нарезать этот канал"),
                  "no_plan": (402, "Нужна подписка")}
        if res in errors:
            code, text = errors[res]
            raise HTTPException(code, text)
        on_change()
        return channels_of(user["id"])

    @app.delete("/channels/{key}")
    def remove_channel(key: str, user=Depends(current_user)):
        db.unfollow(user["id"], key)
        on_change()
        return channels_of(user["id"])

    # ---------- клипы ----------
    @app.get("/clips")
    def clips(user=Depends(current_user)):
        out = []
        rated = db.my_ratings(user["id"])
        plan = db.plan_of(user) or PLANS["trial"]
        for c in db.user_clips(user["id"]):
            base = f"{cfg.public_url}/clips/{c['id']}"
            src = from_key(c["channel"])
            out.append({"id": c["id"], "channel": src.name.lstrip("@"), "platform": src.platform,
                        "platform_title": src.title, "channel_key": c["channel"], "reason": c["reason"], "kind": c["kind"],
                        "title": c["title"], "rating": rated.get(c["id"], 0),
                        "created": c["created"], "duration": variants.duration_for(c, plan.long_clips),
                        "moment": variants.moment_for(c, plan.long_clips),
                        "quality": variants.want_for(plan, c).height,
                        "messages": json.loads(c["messages"] or "[]"),
                        "video": f"{base}/video", "thumb": f"{base}/thumb" if c["thumb"] else None,
                        "vertical": f"{base}/vertical" if plan.vertical else None})
        return out

    @app.get("/clips/{clip_id}/{kind}")
    def clip_file(clip_id: str, kind: str, user=Depends(current_user)):
        c = db.clip(clip_id)
        if c is None or not db.has_clip(user["id"], clip_id):
            raise HTTPException(404, "Клип не найден")
        plan = db.plan_of(user) or PLANS["trial"]
        if kind == "thumb":
            path = cfg.clips_dir / c["thumb"] if c["thumb"] else None
        elif kind in ("video", "vertical"):
            # версия под тариф: качество и длина; делается при первом запросе
            path = variants.path_for(cfg.clips_dir, c, variants.want_for(plan, c, vertical=kind == "vertical"))
        else:
            path = None
        if path is None or not path.exists():
            raise HTTPException(404, "Файл уже удалён с сервера, он есть в Telegram")
        return FileResponse(path)

    # ---------- оплата (RevenueCat присылает события App Store и Google Play) ----------
    @app.post("/billing/revenuecat")
    async def revenuecat(request: Request, authorization: str | None = Header(None)):
        if not cfg.revenuecat_secret or authorization != f"Bearer {cfg.revenuecat_secret}":
            raise HTTPException(401)
        event = (await request.json()).get("event", {})
        try:
            uid = int(event.get("app_user_id", ""))
        except ValueError:
            return {"ok": True, "ignored": "unknown user"}
        if db.user(uid) is None:
            return {"ok": True, "ignored": "unknown user"}
        kind = event.get("type", "")
        ids = " ".join([event.get("product_id") or "", *(event.get("entitlement_ids") or [])]).lower()
        plan = plan_from_product(ids)
        if kind in ("INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE") and plan:
            until = (event.get("expiration_at_ms") or 0) / 1000 or time.time() + 31 * 86400
            db.set_plan(uid, plan, until)
        elif kind == "EXPIRATION":
            db.set_plan(uid, None, None)
        on_change()
        return {"ok": True}

    # ---------- для владельца сервиса ----------
    @app.get("/admin/stats")
    def admin_stats(x_admin_token: str | None = Header(None), token: str | None = Query(None)):
        """Цифры для владельца. Можно открыть в браузере: /admin/stats?token=ADMIN_TOKEN"""
        if not cfg.admin_token or (x_admin_token or token) != cfg.admin_token:
            raise HTTPException(401)
        return db.stats()

    @app.post("/admin/block")
    def admin_block(body: ChannelIn, x_admin_token: str | None = Header(None)):
        """Стример попросил убрать свой канал: перестаём его нарезать для всех."""
        if not cfg.admin_token or x_admin_token != cfg.admin_token:
            raise HTTPException(401)
        ch = normalize_channel(body.channel, body.platform)
        if not ch:
            raise HTTPException(400)
        db.block_channel(ch)
        on_change()
        return {"ok": True, "blocked": ch}

    return app
