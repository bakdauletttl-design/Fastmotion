"""Захват стрима: streamlink (как библиотека) -> ffmpeg -> кольцевой буфер из коротких .ts кусков."""
from __future__ import annotations

import asyncio
import logging
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, BinaryIO, Callable

from .paths import FFMPEG, NO_WINDOW

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


class StreamOffline(Exception):
    pass


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
        self.state = "запуск"
        self._listeners: list[SegmentCallback] = []

    def on_segment(self, cb: SegmentCallback) -> None:
        self._listeners.append(cb)

    def segments_between(self, start: float, end: float) -> list[Segment]:
        return [s for s in self.segments if s.end > start and s.start < end]

    def open_stream(self) -> BinaryIO:
        """Открывает поток Twitch. Блокирующий вызов, выполняется в отдельном потоке."""
        from streamlink import Streamlink
        from streamlink.options import Options

        session = Streamlink()
        streams = session.streams(f"https://twitch.tv/{self.channel}",
                                  options=Options({"disable-ads": True}))
        if not streams:
            raise StreamOffline()
        stream = streams.get(self.quality) or streams.get("best")
        return stream.open()

    async def run(self) -> None:
        """Бесконечный цикл: ждём эфир, пишем, при обрыве переподключаемся."""
        while True:
            try:
                await self._record_once()
                self.state = "стрим закончился"
            except asyncio.CancelledError:
                raise
            except StreamOffline:
                self.state = "канал офлайн, жду начала стрима"
            except Exception as e:
                log.exception("Ошибка захвата")
                self.state = f"ошибка: {e}"
            self.live = False
            await asyncio.sleep(30)

    async def _record_once(self) -> None:
        self.buffer_dir.mkdir(parents=True, exist_ok=True)
        for old in self.buffer_dir.glob("*"):
            old.unlink(missing_ok=True)
        self.segments.clear()
        self.state = "подключаюсь к стриму"

        source = await asyncio.to_thread(self.open_stream)

        list_file = self.buffer_dir / "segments.csv"
        list_file.touch()
        prefix = f"seg_{int(time.time())}_"
        ffmpeg = subprocess.Popen([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
            "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy",
            "-f", "segment", "-segment_time", str(self.segment_seconds),
            "-reset_timestamps", "1",
            "-segment_list", str(list_file), "-segment_list_type", "csv",
            str(self.buffer_dir / f"{prefix}%06d.ts"),
        ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **NO_WINDOW)
        self.state = "идёт запись"
        log.info("Запись стрима %s запущена", self.channel)

        stop = threading.Event()

        def pump() -> None:
            try:
                while not stop.is_set():
                    data = source.read(64 * 1024)
                    if not data:
                        break
                    ffmpeg.stdin.write(data)
            except (OSError, ValueError):
                pass
            finally:
                try:
                    ffmpeg.stdin.close()
                except OSError:
                    pass

        watcher = asyncio.create_task(self._watch_list(list_file))
        try:
            await asyncio.to_thread(pump)
            await asyncio.to_thread(ffmpeg.wait, 15)
        finally:
            stop.set()
            watcher.cancel()
            try:
                source.close()
            except Exception:
                pass
            if ffmpeg.poll() is None:
                ffmpeg.kill()

    async def _watch_list(self, list_file: Path) -> None:
        """Следим за csv-списком ffmpeg: строка появляется, когда кусок дописан."""
        pos = 0
        while True:
            await asyncio.sleep(0.5)
            with list_file.open("rb") as f:
                f.seek(pos)
                chunk = f.read()
            if not chunk or not chunk.endswith(b"\n"):
                continue
            pos += len(chunk)
            for line in chunk.decode("utf-8", errors="replace").splitlines():
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
