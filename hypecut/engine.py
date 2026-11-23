"""Связывает всё вместе: запись, детекторы, нарезка, доставка."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime

from .capture import Segment, StreamRecorder
from .chat import chat_messages
from .clipper import build_clip, make_thumbnail, mean_volume
from .config import Settings
from .detector import AudioPeakDetector, ChatSpikeDetector, Trigger
from .telegram import TelegramSender

log = logging.getLogger(__name__)


@dataclass
class Clip:
    id: str
    file: str
    thumb: str | None
    reason: str
    created: float
    duration: float
    sent_telegram: bool = False


class Engine:
    def __init__(self, settings: Settings):
        self.s = settings
        self.clips: list[Clip] = []
        self._index = settings.clips_dir / "clips.json"
        self._tasks: list[asyncio.Task] = []
        self.running = False
        self._load()
        self._build()

    def _build(self) -> None:
        s = self.s
        self.recorder = StreamRecorder(s.channel, s.quality, s.buffer_dir,
                                       s.segment_seconds, s.buffer_seconds)
        self.chat = ChatSpikeDetector(s.chat_window, s.chat_multiplier,
                                      s.chat_min_messages, s.hype_words)
        self.audio = AudioPeakDetector(s.audio_db_above)
        self.telegram = TelegramSender(s.telegram_token, s.telegram_chat_id)
        self.chat_rate = 0.0
        self.chat_baseline = 0.0
        self.chat_connected = False
        self.last_level: float | None = None
        self._last_trigger = 0.0

    # ---------- хранение списка клипов ----------
    def _load(self) -> None:
        if self._index.exists():
            self.clips = [Clip(**c) for c in json.loads(self._index.read_text("utf-8"))]

    def save_index(self) -> None:
        self._index.parent.mkdir(parents=True, exist_ok=True)
        self._index.write_text(json.dumps([asdict(c) for c in self.clips], ensure_ascii=False, indent=1), "utf-8")

    # ---------- жизненный цикл ----------
    async def start(self) -> None:
        """Запускает слежение за каналом. Без канала просто ждёт настроек."""
        if not self.s.channel or self.running:
            return
        if self.s.audio_enabled:
            self.recorder.on_segment(self._on_segment)
        self._tasks = [
            asyncio.create_task(self.recorder.run()),
            asyncio.create_task(self._chat_loop()),
        ]
        self.running = True
        log.info("Слежу за каналом %s", self.s.channel)

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []
        self.running = False

    async def restart(self) -> None:
        """Применить новые настройки: остановиться, пересобрать детекторы, запуститься."""
        await self.stop()
        self._build()
        await self.start()

    # ---------- источники сигналов ----------
    async def _chat_loop(self) -> None:
        async for _nick, text in chat_messages(self.s.channel):
            self.chat_connected = True
            now = time.time()
            trig = self.chat.add_message(text, now)
            self.chat_rate = self.chat.current_score(now)
            self.chat_baseline = self.chat.baseline()
            if trig:
                self.fire(trig)

    async def _on_segment(self, seg: Segment) -> None:
        level = await mean_volume(seg.path)
        if level is None:
            return
        self.last_level = level
        trig = self.audio.add_level(level, at=seg.end - seg.duration / 2)
        if trig:
            self.fire(trig)

    # ---------- нарезка ----------
    def fire(self, trig: Trigger) -> bool:
        """Запросить клип. Возвращает False, если действует пауза между клипами."""
        if not self.recorder.live:
            return False
        if trig.at - self._last_trigger < self.s.cooldown:
            return False
        self._last_trigger = trig.at
        log.info("Момент: %s", trig.reason)
        asyncio.create_task(self._make_clip(trig))
        return True

    async def _make_clip(self, trig: Trigger) -> None:
        start, end = trig.at - self.s.pre_roll, trig.at + self.s.post_roll
        # ждём, пока ffmpeg допишет куски после момента
        wait = end - time.time() + self.s.segment_seconds + 1
        if wait > 0:
            await asyncio.sleep(wait)
        segments = self.recorder.segments_between(start, end)
        if not segments:
            log.warning("Нет кусков для клипа %s", trig.reason)
            return
        stamp = datetime.fromtimestamp(trig.at).strftime("%Y%m%d_%H%M%S")
        clip_id = f"{self.s.channel}_{stamp}"
        out = self.s.clips_dir / f"{clip_id}.mp4"
        try:
            await build_clip(segments, start, end, out)
        except Exception:
            log.exception("Не удалось собрать клип")
            return
        thumb = await make_thumbnail(out, out.with_suffix(".jpg"))
        clip = Clip(id=clip_id, file=out.name, thumb=thumb.name if thumb else None,
                    reason=trig.reason, created=trig.at, duration=round(end - start, 1))
        self.clips.insert(0, clip)
        self.save_index()
        log.info("Клип готов: %s", out)

        caption = f"🎬 {self.s.channel}: {trig.reason}\n{datetime.fromtimestamp(trig.at):%H:%M:%S}"
        try:
            clip.sent_telegram = await self.telegram.send_video(out, caption)
            self.save_index()
        except Exception:
            log.exception("Ошибка отправки в Telegram")

    def manual_clip(self) -> bool:
        return self.fire(Trigger(at=time.time(), reason="вручную", score=0))

    def status(self) -> dict:
        return {
            "configured": bool(self.s.channel),
            "channel": self.s.channel,
            "live": self.recorder.live,
            "state": self.recorder.state if self.running else "не настроено",
            "buffer_seconds": round(sum(s.duration for s in self.recorder.segments)),
            "chat_connected": self.chat_connected,
            "chat_score": round(self.chat_rate, 1),
            "chat_baseline": round(self.chat_baseline, 1),
            "audio_db": self.last_level,
            "telegram": self.telegram.enabled,
            "clips": len(self.clips),
        }
