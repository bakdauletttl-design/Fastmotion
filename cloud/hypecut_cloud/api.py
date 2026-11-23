"""HTTP API для мобильного приложения."""
from __future__ import annotations

import time
from typing import Callable

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import auth
from .config import Config
from .db import DB, normalize_channel
from .plans import PLANS


class GoogleIn(BaseModel):
    id_token: str


class AppleIn(BaseModel):
    identity_token: str
    name: str | None = None


class DevIn(BaseModel):
    name: str = "tester"


class ChannelIn(BaseModel):
    channel: str


def create_app(cfg: Config, db: DB, on_change: Callable[[], None] = lambda: None) -> FastAPI:
    app = FastAPI(title="HypeCut Cloud", version="0.1")

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
            "channels": db.follows(user["id"]),
        }

    @app.get("/health")
    def health():
        return {"ok": True, "time": time.time()}

    @app.get("/plans")
    def plans():
        return [p.public() for p in PLANS.values()]

    # ---------- вход ----------
    @app.post("/auth/google")
    def login_google(body: GoogleIn):
        try:
            c = auth.verify_google(body.id_token, cfg.google_client_ids)
        except auth.AuthError as e:
            raise HTTPException(401, str(e))
        return session(db.upsert_user("google", c["sub"], c.get("email"), c.get("name")))

    @app.post("/auth/apple")
    def login_apple(body: AppleIn):
        try:
            c = auth.verify_apple(body.identity_token, cfg.apple_bundle_ids)
        except auth.AuthError as e:
            raise HTTPException(401, str(e))
        return session(db.upsert_user("apple", c["sub"], c.get("email"), body.name))

    @app.post("/auth/dev")
    def login_dev(body: DevIn):
        if not cfg.dev_login:
            raise HTTPException(404)
        return session(db.upsert_user("dev", body.name, None, body.name))

    # ---------- аккаунт ----------
    @app.get("/me")
    def me(user=Depends(current_user)):
        return me_dict(user)

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
        return db.follows(user["id"])

    @app.post("/channels")
    def add_channel(body: ChannelIn, user=Depends(current_user)):
        ch = normalize_channel(body.channel)
        if not ch:
            raise HTTPException(400, "Не похоже на Twitch-канал. Пример: twitch.tv/имя")
        res = db.follow(user["id"], ch)
        errors = {"limit": (403, "На этом тарифе больше каналов нельзя"),
                  "blocked": (403, "Стример попросил не нарезать этот канал"),
                  "no_plan": (402, "Нужна подписка")}
        if res in errors:
            code, text = errors[res]
            raise HTTPException(code, text)
        on_change()
        return db.follows(user["id"])

    @app.delete("/channels/{channel}")
    def remove_channel(channel: str, user=Depends(current_user)):
        db.unfollow(user["id"], channel.lower())
        on_change()
        return db.follows(user["id"])

    # ---------- клипы ----------
    @app.get("/clips")
    def clips(user=Depends(current_user)):
        out = []
        for c in db.user_clips(user["id"]):
            base = f"{cfg.public_url}/clips/{c['id']}"
            out.append({"id": c["id"], "channel": c["channel"], "reason": c["reason"], "kind": c["kind"],
                        "created": c["created"], "duration": c["duration"],
                        "video": f"{base}/video", "thumb": f"{base}/thumb" if c["thumb"] else None,
                        "vertical": f"{base}/vertical" if c["vertical_file"] else None})
        return out

    @app.get("/clips/{clip_id}/{kind}")
    def clip_file(clip_id: str, kind: str, user=Depends(current_user)):
        c = db.clip(clip_id)
        if c is None or not db.has_clip(user["id"], clip_id):
            raise HTTPException(404, "Клип не найден")
        name = {"video": c["file"], "vertical": c["vertical_file"], "thumb": c["thumb"]}.get(kind)
        path = cfg.clips_dir / name if name else None
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
        plan = "pro" if "pro" in ids else "standard" if "standard" in ids else None
        if kind in ("INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE") and plan:
            until = (event.get("expiration_at_ms") or 0) / 1000 or time.time() + 31 * 86400
            db.set_plan(uid, plan, until)
        elif kind == "EXPIRATION":
            db.set_plan(uid, None, None)
        on_change()
        return {"ok": True}

    # ---------- для владельца сервиса ----------
    @app.post("/admin/block")
    def admin_block(body: ChannelIn, x_admin_token: str | None = Header(None)):
        """Стример попросил убрать свой канал: перестаём его нарезать для всех."""
        if not cfg.admin_token or x_admin_token != cfg.admin_token:
            raise HTTPException(401)
        ch = normalize_channel(body.channel)
        if not ch:
            raise HTTPException(400)
        db.block_channel(ch)
        on_change()
        return {"ok": True, "blocked": ch}

    return app
