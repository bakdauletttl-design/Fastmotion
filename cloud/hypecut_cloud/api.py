"""HTTP API для мобильного приложения."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import time
from datetime import datetime, timezone
from typing import Callable

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from pathlib import Path

from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from . import auth, enhance, variants
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
    "Канал не найден": "Channel not found",
    "Стример сейчас не в эфире": "The streamer is not live right now",
    "Подожди пару секунд перед следующим клипом": "Wait a couple of seconds before the next clip",
    "Не получилось вырезать клип, попробуй ещё раз": "Could not cut the clip, please try again",
    "Неверные границы клипа": "Invalid clip range",
    "Вертикальные клипы есть на Standard и выше": "Vertical clips are available on Standard and above",
    "Не получилось смонтировать клип": "Could not render the clip",
    "Сначала подключи Telegram": "Connect Telegram first",
    "Telegram не принял видео": "Telegram did not accept the video",
    "В хайлайтах от 1 до 12 моментов": "Highlights take 1 to 12 moments",
}


class RateIn(BaseModel):
    value: int  # 1 нравится, -1 не нравится, 0 убрать оценку


class PushIn(BaseModel):
    token: str


class CutIn(BaseModel):
    seconds: float = 30     # сколько секунд до нажатия взять
    behind: float = 0       # на сколько плеер отстаёт от самого свежего куска


class EditIn(BaseModel):
    start: float = 0               # секунда начала внутри клипа
    end: float | None = None       # секунда конца (None: до конца)
    vertical: bool = True          # 9:16: вебка сверху, игра снизу
    subtitles: bool = True
    title: str | None = None       # None: заголовок клипа, "": без заголовка


class PartIn(BaseModel):
    clip: str
    start: float = 0
    end: float | None = None


class HighlightIn(BaseModel):
    parts: list[PartIn]
    vertical: bool = True
    subtitles: bool = True
    title: str | None = None


class SendIn(BaseModel):
    edit: str | None = None        # id смонтированной версии из /edit; None: обычная версия клипа


class ChannelIn(BaseModel):
    channel: str
    platform: str | None = None  # для ника без ссылки: twitch | youtube | kick | vk | tiktok


def create_app(cfg: Config, db: DB, on_change: Callable[[], None] = lambda: None,
               status: Callable[[str], dict] | None = None, twitch: Twitch | None = None,
               live: Callable[[str], object] | None = None, telegram=None) -> FastAPI:
    """live(key) отдаёт воркер канала (запись эфира), telegram: клиент бота для отправки клипов."""
    app = FastAPI(title="HypeCut Cloud", version="0.1")
    twitch = twitch or Twitch()
    last_cut: dict[int, float] = {}

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
    def clip_dict(c, plan, rated: dict[str, int]) -> dict:
        base = f"{cfg.public_url}/clips/{c['id']}"
        src = from_key(c["channel"])
        return {"id": c["id"], "channel": src.name.lstrip("@"), "platform": src.platform,
                "platform_title": src.title, "channel_key": c["channel"], "reason": c["reason"], "kind": c["kind"],
                "title": c["title"], "rating": rated.get(c["id"], 0),
                "created": c["created"], "duration": variants.duration_for(c, plan.long_clips),
                "source_duration": c["duration"],
                "moment": variants.moment_for(c, plan.long_clips),
                "quality": variants.want_for(plan, c).height,
                "messages": json.loads(c["messages"] or "[]"),
                "video": f"{base}/video", "thumb": f"{base}/thumb" if c["thumb"] else None,
                "vertical": f"{base}/vertical" if plan.vertical else None}

    @app.get("/clips")
    def clips(user=Depends(current_user)):
        rated = db.my_ratings(user["id"])
        plan = db.plan_of(user) or PLANS["trial"]
        return [clip_dict(c, plan, rated) for c in db.user_clips(user["id"])]

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

    # ---------- эфир в приложении и клип своими руками ----------
    def watchable(key: str, user):
        if key not in db.follows(user["id"]):
            raise HTTPException(404, "Канал не найден")
        if not db.plan_of(user):
            raise HTTPException(402, "Нужна подписка")
        w = live(key) if live else None
        if w is None or w.live_edge() is None:
            raise HTTPException(409, "Стример сейчас не в эфире")
        return w

    def raw_token(request: Request) -> str:
        return (request.headers.get("authorization") or "").removeprefix("Bearer ").strip() or \
            request.query_params.get("token", "")

    @app.get("/live/{key}")
    def live_info(key: str, request: Request, user=Depends(current_user)):
        """Можно ли смотреть эфир прямо в приложении и сколько секунд назад можно вырезать."""
        w = live(key) if live else None
        on_air = key in db.follows(user["id"]) and w is not None and w.live_edge() is not None
        return {"live": on_air, "max_seconds": max(10, min(90, cfg.buffer_seconds - 20)),
                "playlist": f"{cfg.public_url}/live/{key}/index.m3u8?token={raw_token(request)}" if on_air else None,
                "url": from_key(key).url}

    @app.get("/live/{key}/index.m3u8")
    def live_playlist(key: str, request: Request, user=Depends(current_user)):
        """Эфир из буфера сервера в формате HLS: плеер телефона играет его как обычный live."""
        w = watchable(key, user)
        segs = list(w.recorder.segments)[-8:]
        tok = raw_token(request)
        seq = _seq(segs[0].path.name)
        out = ["#EXTM3U", "#EXT-X-VERSION:3",
               f"#EXT-X-TARGETDURATION:{math.ceil(max(x.duration for x in segs))}",
               f"#EXT-X-MEDIA-SEQUENCE:{seq}", f"#EXT-X-DISCONTINUITY-SEQUENCE:{seq}"]
        for x in segs:
            # каждый кусок пишется с нуля по времени, поэтому для плеера это отдельный отрезок
            stamp = datetime.fromtimestamp(x.start, timezone.utc).isoformat(timespec="milliseconds")
            out += ["#EXT-X-DISCONTINUITY", f"#EXT-X-PROGRAM-DATE-TIME:{stamp.replace('+00:00', 'Z')}",
                    f"#EXTINF:{x.duration:.3f},", f"{x.path.name}?token={tok}"]
        return Response("\n".join(out) + "\n", media_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-cache"})

    @app.get("/live/{key}/{name}")
    def live_segment(key: str, name: str, user=Depends(current_user)):
        w = watchable(key, user)
        seg = next((x for x in w.recorder.segments if x.path.name == name), None)
        if seg is None or not seg.path.exists():
            raise HTTPException(404)
        return FileResponse(seg.path, media_type="video/mp2t")

    @app.post("/live/{key}/clip")
    async def cut(key: str, body: CutIn, user=Depends(current_user)):
        """Кнопка «Клип»: режет последние секунды того, что человек видит в плеере, только для него."""
        w = watchable(key, user)
        now = time.time()
        if now - last_cut.get(user["id"], 0) < 3:
            raise HTTPException(429, "Подожди пару секунд перед следующим клипом")
        last_cut[user["id"]] = now
        seconds = max(5.0, min(float(body.seconds), 90.0, cfg.buffer_seconds - 20.0))
        behind = max(0.0, min(float(body.behind), cfg.buffer_seconds - seconds - 10))
        clip_id = await w.cut_now(user["id"], seconds, behind)
        c = db.clip(clip_id) if clip_id else None
        if c is None:
            raise HTTPException(500, "Не получилось вырезать клип, попробуй ещё раз")
        return clip_dict(c, db.plan_of(user) or PLANS["trial"], {})

    def my_clip(clip_id: str, user):
        c = db.clip(clip_id)
        if c is None or not db.has_clip(user["id"], clip_id):
            raise HTTPException(404, "Клип не найден")
        return c

    async def render(c, user, start: float, end: float | None, vertical: bool, subtitles: bool,
                     title: str | None):
        """Смонтированная версия куска клипа. Одинаковые настройки не монтируются второй раз."""
        plan = db.plan_of(user) or PLANS["trial"]
        full = c["duration"] or 0
        start, end = max(0.0, start), min(full, end if end is not None else full)
        if end - start < 1:
            raise HTTPException(400, "Неверные границы клипа")
        if vertical and not plan.vertical:
            raise HTTPException(403, "Вертикальные клипы есть на Standard и выше")
        title = c["title"] if title is None else (title.strip()[:80] or None)
        h = variants.want_for(plan, c).height
        key = json.dumps([round(start, 1), round(end, 1), vertical, subtitles, title, h], ensure_ascii=False)
        eid = hashlib.sha1(key.encode()).hexdigest()[:10]
        out = cfg.clips_dir / f"{c['id']}.vE{eid}.mp4"
        if not out.exists():
            src = cfg.clips_dir / c["file"]
            if not src.exists():
                raise HTTPException(404, "Файл уже удалён с сервера, он есть в Telegram")
            if vertical:
                words = [enhance.Word(*x) for x in json.loads(c["words"] or "[]")] if subtitles else None
                moment = c["moment"] - start if c["moment"] is not None and start <= c["moment"] <= end else None
                done = await asyncio.to_thread(enhance.make_vertical, src, out, words, h, start, end - start,
                                               title, moment)
            else:
                done = await asyncio.to_thread(enhance.make_horizontal, src, out, h, start, end - start)
            if done is None:
                raise HTTPException(500, "Не получилось смонтировать клип")
        return eid, out, round(end - start, 1)

    @app.post("/clips/{clip_id}/edit")
    async def edit(clip_id: str, body: EditIn, user=Depends(current_user)):
        """Быстрый монтаж: обрезка, вертикаль (вебка сверху, игра снизу), субтитры, заголовок."""
        c = my_clip(clip_id, user)
        eid, _, dur = await render(c, user, body.start, body.end, body.vertical, body.subtitles, body.title)
        return {"id": eid, "video": f"{cfg.public_url}/clips/{clip_id}/edit/{eid}", "duration": dur}

    hl_dir = cfg.clips_dir / "highlights"

    @app.post("/highlights")
    async def highlights(body: HighlightIn, user=Depends(current_user)):
        """Хайлайты: несколько моментов подряд в одном ролике. Заголовок только на первом куске."""
        if not 1 <= len(body.parts) <= 12:
            raise HTTPException(400, "В хайлайтах от 1 до 12 моментов")
        files, total = [], 0.0
        for i, part in enumerate(body.parts):
            c = my_clip(part.clip, user)
            _, path, dur = await render(c, user, part.start, part.end, body.vertical, body.subtitles,
                                        body.title if i == 0 else "")
            files.append(path)
            total += dur
        hid = hashlib.sha1(f"{user['id']}|{[str(f.name) for f in files]}".encode()).hexdigest()[:12]
        out = hl_dir / f"hl_{user['id']}_{hid}.mp4"
        if not out.exists():
            hl_dir.mkdir(parents=True, exist_ok=True)
            if await asyncio.to_thread(enhance.concat, files, out) is None:
                raise HTTPException(500, "Не получилось смонтировать клип")
        return {"id": hid, "video": f"{cfg.public_url}/highlights/{hid}", "duration": round(total, 1)}

    def my_highlight(hid: str, user):
        path = hl_dir / f"hl_{user['id']}_{hid}.mp4"
        if not re.fullmatch(r"[0-9a-f]{12}", hid) or not path.exists():
            raise HTTPException(404, "Клип не найден")
        return path

    @app.get("/highlights/{hid}")
    def highlight_file(hid: str, user=Depends(current_user)):
        return FileResponse(my_highlight(hid, user), media_type="video/mp4")

    @app.post("/highlights/{hid}/telegram")
    async def highlight_to_telegram(hid: str, user=Depends(current_user)):
        path = my_highlight(hid, user)
        if not user["telegram_chat_id"]:
            raise HTTPException(409, "Сначала подключи Telegram")
        if telegram is None:
            raise HTTPException(503, "Бот ещё не настроен на сервере")
        ok, _ = await telegram.send_video(user["telegram_chat_id"], "🔥 HypeCut · хайлайты", path=path)
        if not ok:
            raise HTTPException(502, "Telegram не принял видео")
        return {"ok": True}

    @app.get("/clips/{clip_id}/edit/{eid}")
    def edited(clip_id: str, eid: str, user=Depends(current_user)):
        my_clip(clip_id, user)
        path = cfg.clips_dir / f"{clip_id}.vE{eid}.mp4"
        if not re.fullmatch(r"[0-9a-f]{10}", eid) or not path.exists():
            raise HTTPException(404, "Клип не найден")
        return FileResponse(path, media_type="video/mp4")

    @app.post("/clips/{clip_id}/telegram")
    async def to_telegram(clip_id: str, body: SendIn, user=Depends(current_user)):
        """Отправить клип (или смонтированную версию) себе в Telegram."""
        c = my_clip(clip_id, user)
        if not user["telegram_chat_id"]:
            raise HTTPException(409, "Сначала подключи Telegram")
        if telegram is None:
            raise HTTPException(503, "Бот ещё не настроен на сервере")
        if body.edit:
            path = cfg.clips_dir / f"{clip_id}.vE{body.edit}.mp4"
            if not re.fullmatch(r"[0-9a-f]{10}", body.edit) or not path.exists():
                raise HTTPException(404, "Клип не найден")
        else:
            plan = db.plan_of(user) or PLANS["trial"]
            path, _ = await asyncio.to_thread(variants.for_telegram, cfg.clips_dir, c, variants.want_for(plan, c))
            if path is None:
                raise HTTPException(404, "Файл уже удалён с сервера, он есть в Telegram")
        src = from_key(c["channel"])
        caption = (f"🔥 {c['title']}\n" if c["title"] else "") + f"HypeCut · {src.name.lstrip('@')} ({src.title})"
        ok, _ = await telegram.send_video(user["telegram_chat_id"], caption, path=path)
        if not ok:
            raise HTTPException(502, "Telegram не принял видео")
        return {"ok": True}

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


def _seq(name: str) -> int:
    """Номер куска из имени seg_<время>_000123.ts."""
    m = re.search(r"_(\d+)\.ts$", name)
    return int(m.group(1)) if m else 0
