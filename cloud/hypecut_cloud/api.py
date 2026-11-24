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

from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel

from . import auth, enhance, variants
from .config import Config
from .db import DB, normalize_channel
from .pipeline import meetings
from .pipeline.connectors import CONNECTORS, SourceError, check_url, platform_of
from .pipeline.scenarios import SCENARIOS
from .plans import PLANS, addon, long_video_plan, plan_from_product, pricing_public
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
    "Файл не найден, загрузи его ещё раз": "File not found, please upload it again",
    "Можно загрузить только музыку или видео": "You can upload only music or video",
    "Файл слишком большой": "The file is too large",
    "Не получилось прочитать файл": "Could not read the file",
}


class FavIn(BaseModel):
    on: bool = True


class RateIn(BaseModel):
    value: int  # 1 нравится, -1 не нравится, 0 убрать оценку


class PushIn(BaseModel):
    token: str


class CutIn(BaseModel):
    seconds: float = 30     # сколько секунд до нажатия взять
    behind: float = 0       # на сколько плеер отстаёт от самого свежего куска


class Style(BaseModel):
    """Оформление в монтаже: шрифт, своя музыка, своё видео поверх."""
    font: str = "classic"          # classic | russo | rubik | lobster | pixel
    music: str | None = None       # id загруженного аудио (/uploads)
    music_volume: float = 0.35
    overlay: str | None = None     # id загруженного видео, которое встанет поверх клипа
    overlay_pos: str = "top"       # top: крупно сверху, corner: маленьким окном в углу
    text_color: str | None = None  # цвет субтитров #RRGGBB
    word_color: str | None = None  # цвет слова, которое звучит сейчас
    title_color: str | None = None # цвет заголовка

    def colors(self) -> dict:
        return {"text": self.text_color, "word": self.word_color, "title": self.title_color}


class EditIn(Style):
    start: float = 0               # секунда начала внутри клипа
    end: float | None = None       # секунда конца (None: до конца)
    vertical: bool = True          # 9:16: вебка сверху, игра снизу
    subtitles: bool = True
    title: str | None = None       # None: заголовок клипа, "": без заголовка
    words: list[tuple[float, float, str]] | None = None  # исправленные субтитры (секунды исходного клипа)


class PartIn(BaseModel):
    clip: str
    start: float = 0
    end: float | None = None


class HighlightIn(Style):
    parts: list[PartIn]
    vertical: bool = True
    subtitles: bool = True
    title: str | None = None
    transition: str = "none"       # none | fade | slide | zoom | wipe | flash


class SendIn(BaseModel):
    edit: str | None = None        # id смонтированной версии из /edit; None: обычная версия клипа


class SourceIn(BaseModel):
    """Длинное видео: файл (upload), ссылка (url), запись встречи (meeting) или мероприятие (event)."""
    kind: str
    scenario: str = "auto"
    platform: str | None = None    # для встречи: zoom | meet | teams
    title: str | None = None
    url: str | None = None
    upload: str | None = None      # id из /uploads?kind=source
    recording: str | None = None   # id записи встречи
    rights: bool = False           # «это моё видео, или у меня есть право его использовать»


class ReviewIn(BaseModel):
    status: str                    # approved | rejected | pending


class PlanIn(BaseModel):
    id: str
    period: str = "month"          # month | year


class HoursIn(BaseModel):
    id: str


class QuoteIn(BaseModel):
    kind: str                      # business | event
    text: str


class OptOutIn(BaseModel):
    channel: str
    contact: str
    text: str = ""
    owner: bool = False


class ChannelIn(BaseModel):
    channel: str
    platform: str | None = None  # для ника без ссылки: twitch | youtube | kick | vk | tiktok


def create_app(cfg: Config, db: DB, on_change: Callable[[], None] = lambda: None,
               status: Callable[[str], dict] | None = None, twitch: Twitch | None = None,
               live: Callable[[str], object] | None = None, telegram=None,
               on_source: Callable[[], None] = lambda: None) -> FastAPI:
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
            "usage": db.usage(user["id"]),
        }

    def channels_of(uid: int) -> list[dict]:
        out = []
        for k in db.follows(uid):
            st = status(k) if status else {"live": False, "clips_recent": db.clips_since(k, time.time() - 12 * 3600)}
            sid = st.pop("stream_id", None)
            # сколько клипов этого эфира уже пришло человеку: лимит тарифа считается за стрим
            st["my_clips_stream"] = db.received_in_stream(uid, sid) if sid else 0
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

    @app.get("/streamers", include_in_schema=False)
    def streamers():
        return FileResponse(static / "streamers.html", media_type="text/html")

    optout_times: list[float] = []

    @app.post("/streamers/request")
    def streamer_request(body: OptOutIn):
        """Стример просит больше не нарезать его канал. Владелец сервиса проверяет и блокирует через /admin/block."""
        ch = normalize_channel(body.channel)
        if not ch:
            raise HTTPException(400, "Не похоже на канал. Пример: twitch.tv/имя или youtube.com/@имя")
        if not body.owner or len(body.contact.strip()) < 3:
            raise HTTPException(400, "Укажите, как с вами связаться, и подтвердите, что канал ваш")
        now = time.time()
        optout_times[:] = [t for t in optout_times if t > now - 3600]
        if len(optout_times) > 50:  # защита от спама
            raise HTTPException(429, "Слишком много заявок, попробуйте через час")
        optout_times.append(now)
        db.add_optout(ch, body.contact.strip()[:200], body.text.strip()[:1000])
        return {"ok": True, "channel": ch}

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
    PLATFORM_TITLE = {"file": "Видео", "youtube": "YouTube", "vimeo": "Vimeo", "link": "Ссылка", "zoom": "Zoom",
                      "meet": "Google Meet", "teams": "Microsoft Teams"}

    def clip_dict(c, plan, rated: dict[str, int], favs: set[str] = frozenset()) -> dict:
        base = f"{cfg.public_url}/clips/{c['id']}"
        keys = c.keys()
        if c["channel"].startswith("src:"):  # клип из длинного видео
            srow = db.source(c["channel"][4:])
            platform = (srow["platform"] if srow else None) or "file"
            name, ptitle, skind = (srow["title"] if srow else None) or "Видео", PLATFORM_TITLE.get(platform, platform), srow["kind"] if srow else None
        else:
            src = from_key(c["channel"])
            name, platform, ptitle, skind = src.name.lstrip("@"), src.platform, src.title, None
        extra = {k: c[k] for k in ("status", "score", "speaker", "quote", "emotion", "stream_at", "scenario", "source_id") if k in keys}
        extra["signals"] = json.loads(c["signals"]) if "signals" in keys and c["signals"] else []
        extra["source_kind"] = skind
        return {**extra, "id": c["id"], "channel": name, "platform": platform,
                "platform_title": ptitle, "channel_key": c["channel"], "reason": c["reason"], "kind": c["kind"],
                "title": c["title"], "rating": rated.get(c["id"], 0), "fav": c["id"] in favs,
                "words": json.loads(c["words"] or "[]"),
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
        favs = db.favs(user["id"])
        return [clip_dict(c, plan, rated, favs) for c in db.user_clips(user["id"])]

    @app.post("/clips/{clip_id}/fav")
    def fav(clip_id: str, body: FavIn, user=Depends(current_user)):
        """❤️ Любимый клип: такие клипы не удаляются со временем и собираются в отдельный список."""
        if not db.set_fav(clip_id, user["id"], body.on):
            raise HTTPException(404, "Клип не найден")
        return {"ok": True}

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
        plan = db.plan_of(user) or PLANS["trial"]
        return {"live": on_air, "max_seconds": max(10, min(plan.max_seconds, cfg.buffer_seconds - 20)),
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
        plan = db.plan_of(user) or PLANS["trial"]
        seconds = max(5.0, min(float(body.seconds), float(plan.max_seconds), cfg.buffer_seconds - 20.0))
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

    up_dir = cfg.clips_dir / "uploads"
    UP_KINDS = {"audio": ("m4a", 20 * 1024 * 1024), "video": ("mp4", 60 * 1024 * 1024),
                "source": ("mp4", 8 * 1024 ** 3)}  # длинное видео для «Создать клипы»: пишется сразу на диск

    def upload_path(uid: int, upid: str | None) -> Path | None:
        if not upid:
            return None
        m = re.fullmatch(r"(audio|video|source)_[0-9a-f]{12}", upid)
        path = up_dir / f"u{uid}_{upid}.{UP_KINDS[m.group(1)][0] if m else 'x'}"
        if not m or not path.exists():
            raise HTTPException(404, "Файл не найден, загрузи его ещё раз")
        return path

    @app.post("/uploads")
    async def upload(request: Request, kind: str = Query(...), user=Depends(current_user)):
        """Своя музыка или своё видео для монтажа. Тело запроса: сам файл."""
        if kind not in UP_KINDS:
            raise HTTPException(400, "Можно загрузить только музыку или видео")
        ext, limit = UP_KINDS[kind]
        if kind == "source":
            up_dir.mkdir(parents=True, exist_ok=True)
            seed = "%s:%s" % (user["id"], time.time())
            upid = "source_" + hashlib.sha1(seed.encode()).hexdigest()[:12]
            path = up_dir / f"u{user['id']}_{upid}.{ext}"
            size = 0
            with path.open("wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > limit:
                        f.close()
                        path.unlink(missing_ok=True)
                        raise HTTPException(413, "Файл слишком большой")
                    f.write(chunk)
            if await asyncio.to_thread(enhance.video_duration, path) <= 0:
                path.unlink(missing_ok=True)
                raise HTTPException(400, "Не получилось прочитать файл")
            return {"id": upid}
        data = bytearray()
        async for chunk in request.stream():
            data += chunk
            if len(data) > limit:
                raise HTTPException(413, "Файл слишком большой")
        upid = f"{kind}_{hashlib.sha1(bytes(data)).hexdigest()[:12]}"
        up_dir.mkdir(parents=True, exist_ok=True)
        path = up_dir / f"u{user['id']}_{upid}.{ext}"
        path.write_bytes(bytes(data))
        if await asyncio.to_thread(enhance.video_duration, path) <= 0:
            path.unlink(missing_ok=True)
            raise HTTPException(400, "Не получилось прочитать файл")
        return {"id": upid}

    async def styled(base: Path, out: Path, user, st: Style) -> Path:
        """Музыка и видео поверх: отдельный шаг после монтажа."""
        music, overlay = upload_path(user["id"], st.music), upload_path(user["id"], st.overlay)
        if not music and not overlay:
            return base
        if not out.exists():
            done = await asyncio.to_thread(enhance.decorate, base, out, music, st.music_volume, overlay, st.overlay_pos)
            if done is None:
                raise HTTPException(500, "Не получилось смонтировать клип")
        return out

    async def render(c, user, start: float, end: float | None, vertical: bool, subtitles: bool,
                     title: str | None, font: str = "classic", words: list | None = None, colors: dict | None = None):
        """Смонтированная версия куска клипа. Одинаковые настройки не монтируются второй раз."""
        plan = db.plan_of(user) or PLANS["trial"]
        full = c["duration"] or 0
        start, end = max(0.0, start), min(full, end if end is not None else full)
        if end - start < 1 or end - start > plan.max_seconds + 0.5:
            raise HTTPException(400, "Неверные границы клипа")
        if vertical and not plan.vertical:
            raise HTTPException(403, "Вертикальные клипы есть на Standard и выше")
        title = c["title"] if title is None else (title.strip()[:80] or None)
        font = font if font in enhance.FONTS else "classic"
        words = [list(w) for w in words] if words is not None else json.loads(c["words"] or "[]")
        h = variants.want_for(plan, c).height
        key = json.dumps([round(start, 1), round(end, 1), vertical, subtitles, title, h, font,
                          words if subtitles else None, colors], ensure_ascii=False)
        eid = hashlib.sha1(key.encode()).hexdigest()[:10]
        out = cfg.clips_dir / f"{c['id']}.vE{eid}.mp4"
        if not out.exists():
            src = cfg.clips_dir / c["file"]
            if not src.exists():
                raise HTTPException(404, "Файл уже удалён с сервера, он есть в Telegram")
            if vertical:
                ws = [enhance.Word(float(a), float(b), str(t)[:40]) for a, b, t in words] if subtitles else None
                moment = c["moment"] - start if c["moment"] is not None and start <= c["moment"] <= end else None
                done = await asyncio.to_thread(enhance.make_vertical, src, out, ws, h, start, end - start,
                                               title, moment, font, True, colors)
            else:
                done = await asyncio.to_thread(enhance.make_horizontal, src, out, h, start, end - start)
            if done is None:
                raise HTTPException(500, "Не получилось смонтировать клип")
        return eid, out, round(end - start, 1)

    @app.post("/clips/{clip_id}/edit")
    async def edit(clip_id: str, body: EditIn, user=Depends(current_user)):
        """Быстрый монтаж: обрезка, вертикаль (вебка сверху, игра снизу), субтитры, заголовок."""
        c = my_clip(clip_id, user)
        eid, base, dur = await render(c, user, body.start, body.end, body.vertical, body.subtitles, body.title,
                                      body.font, body.words, body.colors())
        extra = hashlib.sha1(f"{body.music}|{body.music_volume:.2f}|{body.overlay}|{body.overlay_pos}".encode()).hexdigest()[:4]
        if body.music or body.overlay:
            eid = (eid[:6] + extra)
            await styled(base, cfg.clips_dir / f"{clip_id}.vE{eid}.mp4", user, body)
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
                                        body.title if i == 0 else "", body.font, None, body.colors())
            files.append(path)
            total += dur
        hid = hashlib.sha1(f"{user['id']}|{[str(f.name) for f in files]}|{body.transition}|{body.music}|"
                           f"{body.music_volume:.2f}|{body.overlay}|{body.overlay_pos}".encode()).hexdigest()[:12]
        out = hl_dir / f"hl_{user['id']}_{hid}.mp4"
        if not out.exists():
            hl_dir.mkdir(parents=True, exist_ok=True)
            joined = hl_dir / f"hl_{user['id']}_{hid}.join.mp4" if body.music or body.overlay else out
            if not joined.exists() and await asyncio.to_thread(enhance.concat, files, joined, body.transition) is None:
                raise HTTPException(500, "Не получилось смонтировать клип")
            if joined != out:
                await styled(joined, out, user, body)
                joined.unlink(missing_ok=True)
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

    @app.post("/clips/{clip_id}/review")
    def review(clip_id: str, body: ReviewIn, user=Depends(current_user)):
        """Очередь утверждения: принять или отклонить найденный момент."""
        if body.status not in ("approved", "rejected", "pending") or not db.review(user["id"], clip_id, body.status):
            raise HTTPException(404, "Клип не найден")
        return {"ok": True}

    # ---------- длинные видео: файл, ссылка, встреча, мероприятие ----------
    def source_dict(r) -> dict:
        return {"id": r["id"], "kind": r["kind"], "platform": r["platform"], "title": r["title"] or "Видео", "ref": r["ref"] or "",
                "scenario": r["scenario"], "status": r["status"], "progress": r["progress"] or 0, "duration": r["duration"],
                "created": r["created"], "clips": r["clips"] or 0, "speakers": json.loads(r["speakers"] or "[]"),
                "thumb": f"{cfg.public_url}/sources/{r['id']}/thumb" if r["thumb"] else None, "error": r["error"]}

    @app.get("/sources")
    def sources(user=Depends(current_user)):
        return [source_dict(r) for r in db.user_sources(user["id"])]

    @app.post("/sources")
    def create_source(body: SourceIn, user=Depends(current_user)):
        if body.kind not in CONNECTORS:
            raise HTTPException(400, "Такой источник пока не поддерживается")
        if body.scenario != "auto" and body.scenario not in SCENARIOS:
            raise HTTPException(400, "Неизвестный тип видео")
        plan = long_video_plan(db.plan_of(user))
        left = db.hours_left(user["id"], plan)
        if left is not None and left <= 0:
            raise HTTPException(402, "Часы обработки закончились. Докупи часы в «Тарифах»")
        if body.kind == "upload" or (body.kind == "event" and body.upload):
            ref = body.upload or ""
            upload_path(user["id"], ref)  # 404, если файла нет
        elif body.kind in ("url", "event"):
            if not body.rights:
                raise HTTPException(400, "Подтверди, что у тебя есть право использовать это видео")
            try:
                ref = check_url(body.url or "")
            except SourceError as e:
                raise HTTPException(400, str(e))
        else:  # meeting
            if body.platform not in meetings.SERVICES or body.platform not in db.integrations(user["id"]):
                raise HTTPException(400, "Сначала подключи сервис встреч")
            ref = body.recording or ""
            if not ref:
                raise HTTPException(400, "Выбери запись")
        sid = "s" + hashlib.sha1(f"{user['id']}:{ref}:{time.time()}".encode()).hexdigest()[:10]
        row = db.add_source(id=sid, user_id=user["id"], kind=body.kind, platform=platform_of(body.kind, ref, body.platform),
                            title=(body.title or "").strip()[:120] or None, ref=ref, scenario=body.scenario,
                            status="queued", progress=0.0, created=time.time())
        on_source()
        return source_dict(row)

    @app.delete("/sources/{sid}")
    def delete_source(sid: str, user=Depends(current_user)):
        if not db.delete_source(user["id"], sid):
            raise HTTPException(404, "Видео не найдено")
        return {"ok": True}

    @app.get("/sources/{sid}/thumb")
    def source_thumb(sid: str, user=Depends(current_user)):
        r = db.source(sid)
        if r is None or r["user_id"] != user["id"] or not r["thumb"] or not Path(r["thumb"]).exists():
            raise HTTPException(404, "Видео не найдено")
        return FileResponse(r["thumb"])

    # ---------- встречи: Zoom, Google Meet, Microsoft Teams ----------
    def state_for(uid: int, service: str) -> str:
        sig = hashlib.sha256(f"{uid}:{service}:{cfg.jwt_secret}".encode()).hexdigest()[:24]
        return f"{uid}.{service}.{sig}"

    def redirect_for(service: str) -> str:
        return f"{cfg.public_url}/integrations/{service}/callback"

    def fresh_token(uid: int, service: str) -> str:
        it = db.integrations(uid).get(service)
        if it is None:
            raise HTTPException(400, "Сначала подключи сервис встреч")
        if it["expires"] and it["expires"] < time.time() + 60 and it["refresh_token"]:
            try:
                t = meetings.refresh(meetings.SERVICES[service], it["refresh_token"])
            except meetings.MeetingError as e:
                raise HTTPException(401, str(e))
            db.set_integration(uid, service, it["account"], t["access"], t["refresh"], t["expires"])
            return t["access"]
        return it["access_token"]

    @app.get("/integrations")
    def integrations(user=Depends(current_user)):
        have = db.integrations(user["id"])
        return [{"id": s.id, "title": s.title, "connected": s.id in have, "account": have[s.id]["account"] if s.id in have else None,
                 "available": s.ready} for s in meetings.SERVICES.values()]

    @app.post("/integrations/{service}/connect")
    def connect(service: str, user=Depends(current_user)):
        s = meetings.SERVICES.get(service)
        if s is None:
            raise HTTPException(404)
        if not s.ready:
            raise HTTPException(503, f"Подключение {s.title} ещё не настроено на сервере")
        return {"url": meetings.auth_url(s, state_for(user["id"], service), redirect_for(service)), "connected": False}

    @app.get("/integrations/{service}/callback", include_in_schema=False)
    def connect_done(service: str, code: str = "", state: str = ""):
        s = meetings.SERVICES.get(service)
        try:
            uid = int(state.split(".")[0])
        except ValueError:
            uid = 0
        if s is None or not code or state != state_for(uid, service) or db.user(uid) is None:
            raise HTTPException(400, "Ссылка устарела, подключи сервис ещё раз")
        try:
            t = meetings.exchange(s, code, redirect_for(service))
        except meetings.MeetingError as e:
            raise HTTPException(400, str(e))
        db.set_integration(uid, service, None, t["access"], t["refresh"], t["expires"])
        back = f'<p><a href="{cfg.app_url}">Открыть HypeCut</a></p>' if cfg.app_url else ""
        return HTMLResponse(f"<meta name=viewport content='width=device-width'><h2>{s.title} подключён</h2>"
                            f"<p>Вернись в приложение HypeCut: записи уже видны в «Создать клипы».</p>{back}")

    @app.get("/integrations/{service}/recordings")
    def meeting_recordings(service: str, user=Depends(current_user)):
        s = meetings.SERVICES.get(service)
        if s is None:
            raise HTTPException(404)
        try:
            recs = meetings.recordings(s, fresh_token(user["id"], service))
        except meetings.MeetingError as e:
            raise HTTPException(400, str(e))
        except Exception:
            raise HTTPException(502, f"{s.title} сейчас не отвечает")
        return [{k: r[k] for k in ("id", "title", "duration", "date", "participants")} for r in recs]

    @app.delete("/integrations/{service}")
    def disconnect(service: str, user=Depends(current_user)):
        db.drop_integration(user["id"], service)
        return {"ok": True}

    # ---------- тарифы и часы обработки ----------
    @app.get("/pricing")
    def pricing(store: str = "app"):
        return pricing_public("web" if store == "web" else "app")

    @app.post("/billing/plan")
    def choose_plan(body: PlanIn, user=Depends(current_user)):
        """В магазинах приложений оплата идёт через RevenueCat (/billing/revenuecat). Оплаты картой на сайте пока нет:
        в тестовом режиме (DEV_LOGIN=1) тариф включается сразу."""
        p = PLANS.get(body.id)
        if p is None or p.contact or not p.price_usd:
            raise HTTPException(400, "Этот тариф так не выбрать")
        if not cfg.dev_login:
            raise HTTPException(501, "Оплата картой скоро появится. Пока тариф можно купить в приложении или в боте")
        db.set_plan(user["id"], p.id, time.time() + (365 if body.period == "year" else 31) * 86400)
        on_change()
        return {"ok": True, "url": None}

    @app.post("/billing/hours")
    def buy_hours(body: HoursIn, user=Depends(current_user)):
        a = addon(body.id)
        if a is None:
            raise HTTPException(400, "Нет такого пакета")
        if not cfg.dev_login:
            raise HTTPException(501, "Оплата картой скоро появится. Пока часы можно купить в приложении")
        db.add_hours(user["id"], a["hours"], a["price_usd"], "dev")
        return {"ok": True, "url": None}

    @app.post("/billing/quote")
    def quote(body: QuoteIn, user=Depends(current_user)):
        text = body.text.strip()
        if body.kind not in ("business", "event") or len(text) < 3:
            raise HTTPException(400, "Напиши пару слов о задаче")
        db.add_quote(user["id"], body.kind, text[:2000])
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
        pack = re.search(r"hours?_?(\d+)", ids)
        if pack and kind in ("INITIAL_PURCHASE", "NON_RENEWING_PURCHASE"):
            a = addon(f"h{pack.group(1)}")
            if a:
                db.add_hours(uid, a["hours"], a["price_usd"], event.get("id"))
            return {"ok": True}
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
        # клипы этого канала удаляем с сервера, заявки закрываем
        removed = 0
        for c in db.channel_clips(ch):
            for f in [c["file"], c["thumb"], *[p.name for p in variants.all_files(cfg.clips_dir, c["id"])]]:
                if f:
                    (cfg.clips_dir / f).unlink(missing_ok=True)
            db.delete_clip(c["id"])
            removed += 1
        db.x("UPDATE optout_requests SET status='blocked' WHERE channel=? AND status='new'", (ch,))
        on_change()
        return {"ok": True, "blocked": ch, "clips_removed": removed}

    @app.get("/admin/requests")
    def admin_requests(x_admin_token: str | None = Header(None), token: str | None = Query(None)):
        """Заявки стримеров: проверить, что канал их, и заблокировать через /admin/block."""
        if not cfg.admin_token or (x_admin_token or token) != cfg.admin_token:
            raise HTTPException(401)
        return [dict(r) for r in db.optouts()]

    return app


def _seq(name: str) -> int:
    """Номер куска из имени seg_<время>_000123.ts."""
    m = re.search(r"_(\d+)\.ts$", name)
    return int(m.group(1)) if m else 0
