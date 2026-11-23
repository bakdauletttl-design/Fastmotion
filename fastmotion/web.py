"""Веб-интерфейс: статус, список клипов, кнопка «Клип сейчас»."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .engine import Engine

STATIC = Path(__file__).parent / "static"


def create_app(settings: Settings, run_engine: bool = True) -> FastAPI:
    engine = Engine(settings)
    settings.clips_dir.mkdir(parents=True, exist_ok=True)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if run_engine:
            await engine.start()
        yield
        if run_engine:
            await engine.stop()

    app = FastAPI(title="Fastmotion", lifespan=lifespan)
    app.state.engine = engine

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/status")
    async def status():
        return engine.status()

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

    @app.delete("/api/clips/{clip_id}")
    async def delete_clip(clip_id: str):
        for c in list(engine.clips):
            if c.id == clip_id:
                for name in (c.file, c.thumb):
                    if name:
                        (settings.clips_dir / name).unlink(missing_ok=True)
                engine.clips.remove(c)
                engine._save()
                return {"ok": True}
        raise HTTPException(404)

    app.mount("/clips", StaticFiles(directory=settings.clips_dir), name="clips")
    return app
