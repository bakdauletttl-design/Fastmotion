"""Связывает всё вместе: запись, детекторы, нарезка, доставка."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime

from .capture import Segment, StreamRecorder
from .chat import chat_messages
from .clipper import build_clip, make_thumbnail, mean_volume
from .config import Settings
from .detector import AudioPeakDetector, ChatSpikeDetector, Trigger
from .editor import Piece, render
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
    kind: str = "manual"            # chat | audio | manual | edit
    channel: str = ""
    stream_time: float | None = None  # секунда от начала записи, когда случился момент
    moment: float = 0.0             # секунда внутри клипа, где момент
    chat: list = field(default_factory=list)      # активность чата по секундам клипа
    audio: list = field(default_factory=list)     # [секунда в клипе, dB]
    messages: list = field(default_factory=list)  # сообщения чата вокруг момента
    sources: list = field(default_factory=list)   # для монтажа: из каких клипов собран

    @classmethod
    def from_dict(cls, d: dict) -> "Clip":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})


class Engine:
    def __init__(self, settings: Settings):
        self.s = settings
        self.clips: list[Clip] = []
        self._index = settings.clips_dir / "clips.json"
        self._tasks: list[asyncio.Task] = []
        self._pending: set[asyncio.Task] = set()  # клипы, которые ещё режутся
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
        self.telegram = TelegramSender(s.telegram_token if s.telegram_enabled else "", s.telegram_chat_id)
        self.chat_rate = 0.0
        self.chat_baseline = 0.0
        self.chat_connected = False
        self.last_level: float | None = None
        self._last_trigger = 0.0
        self.messages: deque[tuple[float, str, str]] = deque(maxlen=3000)
        self.levels: deque[tuple[float, float]] = deque(maxlen=200)

    # ---------- хранение списка клипов ----------
    def _load(self) -> None:
        if self._index.exists():
            self.clips = [Clip.from_dict(c) for c in json.loads(self._index.read_text("utf-8"))]

    def save_index(self) -> None:
        self._index.parent.mkdir(parents=True, exist_ok=True)
        self._index.write_text(json.dumps([asdict(c) for c in self.clips], ensure_ascii=False, indent=1), "utf-8")

    # ---------- жизненный цикл ----------
    async def start(self) -> None:
        """Запускает слежение за каналом. Без канала просто ждёт настроек."""
        if not self.s.channel or not self.s.active or self.running:
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
        """«Стоп»: прекращаем запись и отменяем клипы, которые ещё не успели отправиться."""
        for t in [*self._tasks, *self._pending]:
            t.cancel()
        await asyncio.gather(*self._tasks, *self._pending, return_exceptions=True)
        self._tasks = []
        self.running = False

    async def restart(self) -> None:
        """Применить новые настройки: остановиться, пересобрать детекторы, запуститься."""
        await self.stop()
        self._build()
        await self.start()

    # ---------- источники сигналов ----------
    async def _chat_loop(self) -> None:
        async for nick, text in chat_messages(self.s.channel):
            self.chat_connected = True
            now = time.time()
            self.messages.append((now, nick, text))
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
        self.levels.append((seg.start + seg.duration / 2, level))
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
        task = asyncio.create_task(self._make_clip(trig))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)
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
        clip_id = self._unique_id(f"{self.s.channel}_{stamp}")
        out = self.s.clips_dir / f"{clip_id}.mp4"
        try:
            await build_clip(segments, start, end, out)
        except Exception:
            log.exception("Не удалось собрать клип")
            return
        thumb = await make_thumbnail(out, out.with_suffix(".jpg"))
        clip_start = max(start, segments[0].start)
        chat = [0.0] * max(1, int(end - clip_start))
        for t, v in self.chat.history(clip_start, end):
            i = int(t - clip_start)
            if 0 <= i < len(chat):
                chat[i] = round(v, 1)
        msgs = [f"{n}: {m}" for t, n, m in self.messages if trig.at - 12 <= t <= trig.at + 4][-12:]
        clip = Clip(id=clip_id, file=out.name, thumb=thumb.name if thumb else None,
                    reason=trig.reason, created=trig.at, duration=round(end - clip_start, 1),
                    kind=trig.kind, channel=self.s.channel,
                    stream_time=round(trig.at - self.recorder.started_at, 1) if self.recorder.started_at else None,
                    moment=round(trig.at - clip_start, 1), chat=chat,
                    audio=[[round(t - clip_start, 1), round(v, 1)] for t, v in self.levels if clip_start <= t <= end],
                    messages=msgs)
        self.clips.insert(0, clip)
        self.save_index()
        log.info("Клип готов: %s", out)

        caption = f"HypeCut · {self.s.channel}\n{trig.reason} · {datetime.fromtimestamp(trig.at):%H:%M:%S}"
        try:
            clip.sent_telegram = await self.telegram.send_video(out, caption)
            self.save_index()
        except Exception:
            log.exception("Ошибка отправки в Telegram")

    async def montage(self, items: list[dict]) -> Clip:
        """Обрезка/склейка: items = [{"id": ..., "start": сек, "end": сек}, ...]."""
        by_id = {c.id: c for c in self.clips}
        pieces = []
        for it in items:
            c = by_id.get(str(it.get("id")))
            if not c:
                raise ValueError("Клип не найден")
            start = max(0.0, float(it.get("start", 0)))
            end = min(c.duration, float(it.get("end", c.duration))) if c.duration else float(it.get("end", 0))
            if end - start < 0.5:
                raise ValueError("Отрезок короче полсекунды")
            pieces.append(Piece(self.s.clips_dir / c.file, start, end))
        if not pieces:
            raise ValueError("Выберите хотя бы один клип")
        now = time.time()
        clip_id = self._unique_id(f"edit_{datetime.fromtimestamp(now):%Y%m%d_%H%M%S}")
        out = await render(pieces, self.s.clips_dir / f"{clip_id}.mp4")
        thumb = await make_thumbnail(out, out.with_suffix(".jpg"))
        total = round(sum(p.end - p.start for p in pieces), 1)
        reason = "обрезка" if len(pieces) == 1 else f"монтаж из {len(pieces)} отрезков"
        clip = Clip(id=clip_id, file=out.name, thumb=thumb.name if thumb else None, reason=reason,
                    created=now, duration=total, kind="edit", channel=self.s.channel,
                    sources=[str(it.get("id")) for it in items])
        self.clips.insert(0, clip)
        self.save_index()
        return clip

    def _unique_id(self, base: str) -> str:
        taken = {c.id for c in self.clips}
        clip_id, n = base, 2
        while clip_id in taken or (self.s.clips_dir / f"{clip_id}.mp4").exists():
            clip_id, n = f"{base}_{n}", n + 1
        return clip_id

    def manual_clip(self) -> bool:
        return self.fire(Trigger(at=time.time(), reason="вручную", score=0, kind="manual"))

    def status(self) -> dict:
        return {
            "configured": bool(self.s.channel),
            "channel": self.s.channel,
            "live": self.running and self.recorder.live,
            "active": self.s.active,
            "telegram_enabled": self.s.telegram_enabled,
            "state": self.recorder.state if self.running else ("остановлено" if self.s.channel else "не настроено"),
            "buffer_seconds": round(sum(s.duration for s in self.recorder.segments)),
            "chat_connected": self.chat_connected,
            "chat_score": round(self.chat_rate, 1),
            "chat_baseline": round(self.chat_baseline, 1),
            "audio_db": self.last_level,
            "telegram": self.telegram.enabled,
            "clips": len(self.clips),
        }
