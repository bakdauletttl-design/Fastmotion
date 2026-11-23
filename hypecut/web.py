"""Веб-интерфейс: настройки, статус, список клипов, кнопка «Клип сейчас»."""
from __future__ import annotations

import os
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .engine import Engine
from .telegram import TelegramSender, find_chat

STATIC = Path(__file__).parent / "static"


def create_app(settings: Settings, run_engine: bool = True) -> FastAPI:
    settings.clips_dir.mkdir(parents=True, exist_ok=True)
    engine = Engine(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if run_engine:
            await engine.start()
        yield
        if run_engine:
            await engine.stop()

    app = FastAPI(title="HypeCut", lifespan=lifespan)
    app.state.engine = engine

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/status")
    async def status():
        return engine.status()

    @app.get("/api/settings")
    async def get_settings():
        return settings.editable()

    @app.post("/api/settings")
    async def save_settings(values: dict = Body(...)):
        try:
            settings.update(values)
        except (TypeError, ValueError) as e:
            raise HTTPException(400, f"Неверное значение: {e}")
        if not settings.channel:
            raise HTTPException(400, "Укажите Twitch-канал")
        settings.save()
        if run_engine:
            await engine.restart()
        else:
            engine._build()
        return {"ok": True}

    @app.post("/api/toggle")
    async def toggle(values: dict = Body(...)):
        """Кнопки «Стоп/Старт» и переключатель отправки в Telegram."""
        settings.update({k: values[k] for k in ("active", "telegram_enabled") if k in values})
        settings.save()
        if run_engine:
            await engine.restart()
        else:
            engine._build()
        return engine.status()

    @app.post("/api/telegram/find-chat")
    async def telegram_find(values: dict = Body(...)):
        token = str(values.get("token", "")).strip()
        if not token:
            raise HTTPException(400, "Вставьте токен бота")
        try:
            return await find_chat(token)
        except Exception as e:
            return {"ok": False, "error": f"Не удалось связаться с Telegram: {e}"}

    @app.post("/api/telegram/test")
    async def telegram_test(values: dict = Body(...)):
        sender = TelegramSender(str(values.get("token", "")).strip(), str(values.get("chat_id", "")).strip())
        if not sender.enabled:
            raise HTTPException(400, "Нужны токен и чат")
        try:
            ok, err = await sender.send_text("HypeCut подключён. Сюда будут приходить клипы.")
        except Exception as e:
            ok, err = False, str(e)
        return {"ok": ok, "error": err}

    @app.get("/api/clips")
    async def clips():
        return [c.__dict__ for c in engine.clips]

    @app.post("/api/clip")
    async def clip_now():
        if not engine.recorder.live:
            raise HTTPException(409, "Стрим не идёт или запись ещё не началась")
        if not engine.manual_clip():
            raise HTTPException(429, "Подождите, недавно уже был клип")
        return {"ok": True, "ready_in": settings.post_roll + settings.segment_seconds}

    @app.post("/api/montage")
    async def montage(values: dict = Body(...)):
        items = values.get("items") or []
        try:
            clip = await engine.montage(items)
        except (ValueError, RuntimeError) as e:
            raise HTTPException(400, str(e))
        return clip.__dict__

    @app.post("/api/open-folder")
    async def open_folder():
        path = str(settings.clips_dir.resolve())
        if os.name == "nt":
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return {"ok": True, "path": path}

    @app.delete("/api/clips/{clip_id}")
    async def delete_clip(clip_id: str):
        for c in list(engine.clips):
            if c.id == clip_id:
                for name in (c.file, c.thumb):
                    if name:
                        (settings.clips_dir / name).unlink(missing_ok=True)
                engine.clips.remove(c)
                engine.save_index()
                return {"ok": True}
        raise HTTPException(404)

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    app.mount("/clips", StaticFiles(directory=settings.clips_dir), name="clips")
    return app
