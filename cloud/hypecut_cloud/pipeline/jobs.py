"""Очередь длинных видео: по одному (или MAX_JOBS) за раз в отдельном потоке, приоритет у старших тарифов."""
from __future__ import annotations

import asyncio
import logging
import os

from ..db import DB
from .engine import Engine

log = logging.getLogger(__name__)


class Jobs:
    def __init__(self, db: DB, engine: Engine, parallel: int | None = None):
        self.db, self.engine = db, engine
        self.parallel = parallel or int(os.environ.get("MAX_JOBS", "1"))
        self._wake = asyncio.Event()
        self.running: set[str] = set()

    def poke(self) -> None:
        self._wake.set()

    async def run(self) -> None:
        # после перезапуска сервера недоделанные видео начинаем заново
        self.db.x("UPDATE sources SET status='queued', progress=0 WHERE status NOT IN ('queued','done','failed')")
        while True:
            while len(self.running) < self.parallel:
                src = self.db.next_source()
                if src is None or src["id"] in self.running:
                    break
                self.running.add(src["id"])
                self.db.set_source(src["id"], status="ingest", progress=0.0)
                asyncio.create_task(self._one(src["id"]))
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=10)
            except asyncio.TimeoutError:
                pass

    async def _one(self, sid: str) -> None:
        try:
            await asyncio.to_thread(self.engine.run, sid)
        finally:
            self.running.discard(sid)
            self._wake.set()
