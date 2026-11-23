"""Захват стрима: streamlink -> ffmpeg -> кольцевой буфер из коротких .ts кусков."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

log = logging.getLogger(__name__)


@dataclass
class Segment:
    path: Path
    start: float  # unix time начала куска (примерно)
    end: float    # unix time конца куска

    @property
    def duration(self) -> float:
        return self.end - self.start


SegmentCallback = Callable[[Segment], Awaitable[None]]


class StreamRecorder:
    def __init__(self, channel: str, quality: str, buffer_dir: Path,
                 segment_seconds: int, buffer_seconds: int):
        self.channel = channel
        self.quality = quality
        self.buffer_dir = buffer_dir
        self.segment_seconds = segment_seconds
        self.buffer_seconds = buffer_seconds
        self.segments: list[Segment] = []
        self.live = False
        self._listeners: list[SegmentCallback] = []

    def on_segment(self, cb: SegmentCallback) -> None:
        self._listeners.append(cb)

    def segments_between(self, start: float, end: float) -> list[Segment]:
        return [s for s in self.segments if s.end > start and s.start < end]

    async def run(self) -> None:
        """Бесконечный цикл: ждём эфир, пишем, при обрыве переподключаемся."""
        while True:
            try:
                await self._record_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Ошибка захвата")
            self.live = False
            log.info("Стрим %s офлайн или оборвался, повтор через 30 с", self.channel)
            await asyncio.sleep(30)

    async def _record_once(self) -> None:
        self.buffer_dir.mkdir(parents=True, exist_ok=True)
        for old in self.buffer_dir.glob("*"):
            old.unlink(missing_ok=True)
        self.segments.clear()

        list_file = self.buffer_dir / "segments.csv"
        list_file.touch()
        prefix = f"seg_{int(time.time())}_"

        read_fd, write_fd = os.pipe()
        streamlink = await asyncio.create_subprocess_exec(
            "streamlink", "--stdout", "--twitch-disable-ads", "--loglevel", "warning",
            f"https://twitch.tv/{self.channel}", self.quality,
            stdout=write_fd, stderr=asyncio.subprocess.PIPE,
        )
        os.close(write_fd)
        ffmpeg = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
            "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy",
            "-f", "segment", "-segment_time", str(self.segment_seconds),
            "-reset_timestamps", "1",
            "-segment_list", str(list_file), "-segment_list_type", "csv",
            "-segment_list_flags", "live",
            str(self.buffer_dir / f"{prefix}%06d.ts"),
            stdin=read_fd, stderr=asyncio.subprocess.PIPE,
        )
        os.close(read_fd)
        log.info("Запись стрима %s запущена", self.channel)

        watcher = asyncio.create_task(self._watch_list(list_file))
        try:
            await ffmpeg.wait()
        finally:
            watcher.cancel()
            for proc in (streamlink, ffmpeg):
                if proc.returncode is None:
                    proc.terminate()
                    try:
                        await asyncio.wait_for(proc.wait(), 5)
                    except asyncio.TimeoutError:
                        proc.kill()
            if streamlink.stderr:
                err = (await streamlink.stderr.read()).decode(errors="replace").strip()
                if err:
                    log.warning("streamlink: %s", err[-500:])

    async def _watch_list(self, list_file: Path) -> None:
        """Следим за csv-списком ffmpeg: строка появляется, когда кусок дописан."""
        pos = 0
        while True:
            await asyncio.sleep(0.5)
            with list_file.open("r", encoding="utf-8") as f:
                f.seek(pos)
                chunk = f.read()
            if not chunk or not chunk.endswith("\n"):
                continue
            pos += len(chunk.encode("utf-8"))
            for line in chunk.splitlines():
                parts = line.strip().split(",")
                if len(parts) < 3:
                    continue
                name, s, e = parts[0], float(parts[1]), float(parts[2])
                now = time.time()
                seg = Segment(self.buffer_dir / name, now - (e - s), now)
                self.segments.append(seg)
                self.live = True
                self._trim()
                for cb in self._listeners:
                    asyncio.create_task(_safe(cb, seg))

    def _trim(self) -> None:
        limit = time.time() - self.buffer_seconds
        while self.segments and self.segments[0].end < limit:
            old = self.segments.pop(0)
            old.path.unlink(missing_ok=True)


async def _safe(cb: SegmentCallback, seg: Segment) -> None:
    try:
        await cb(seg)
    except Exception:
        log.exception("Ошибка обработчика сегмента")
