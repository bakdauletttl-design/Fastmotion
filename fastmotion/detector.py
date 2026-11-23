"""Детекторы ярких моментов: всплеск чата и громкий звук.

Чистая логика без сети и ffmpeg, чтобы её было легко тестировать.
"""
from __future__ import annotations

import re
import statistics
from collections import deque
from dataclasses import dataclass


@dataclass
class Trigger:
    at: float      # время момента (unix time)
    reason: str    # человекочитаемая причина
    score: float   # сила всплеска


class ChatSpikeDetector:
    """Сравнивает число сообщений за последние `window` секунд с обычным уровнем.

    Обычный уровень считается как медиана таких же окон за последние ~5 минут.
    Сообщения с «хайп»-словами (KEKW, POG, клип…) весят в 2 раза больше.
    """

    def __init__(self, window: int = 10, multiplier: float = 3.0,
                 min_messages: int = 15, hype_words: list[str] | None = None,
                 history_seconds: int = 300, warmup_seconds: int = 60):
        self.window = window
        self.multiplier = multiplier
        self.min_messages = min_messages
        self.history_seconds = history_seconds
        self.warmup_seconds = warmup_seconds
        words = [re.escape(w.lower()) for w in (hype_words or [])]
        self._hype = re.compile(r"(?<!\w)(" + "|".join(words) + r")", re.I) if words else None
        self._events: deque[tuple[float, float]] = deque()   # (время, вес)
        self._samples: deque[tuple[float, float]] = deque()  # (время, счёт в окне)
        self._started: float | None = None
        self._last_sample = 0.0

    def _weight(self, text: str) -> float:
        return 2.0 if self._hype and self._hype.search(text) else 1.0

    def add_message(self, text: str, now: float) -> Trigger | None:
        if self._started is None:
            self._started = now
        self._events.append((now, self._weight(text)))
        return self.check(now)

    def current_score(self, now: float) -> float:
        while self._events and self._events[0][0] < now - self.window:
            self._events.popleft()
        return sum(w for _, w in self._events)

    def baseline(self) -> float:
        if not self._samples:
            return 0.0
        return statistics.median(s for _, s in self._samples)

    def check(self, now: float) -> Trigger | None:
        score = self.current_score(now)
        base = self.baseline()

        # раз в секунду добавляем замер для расчёта обычного уровня
        if now - self._last_sample >= 1.0:
            self._samples.append((now, score))
            self._last_sample = now
            while self._samples and self._samples[0][0] < now - self.history_seconds:
                self._samples.popleft()

        if self._started is None or now - self._started < self.warmup_seconds:
            return None
        threshold = max(self.min_messages, base * self.multiplier)
        if score >= threshold:
            ratio = score / max(base, 1.0)
            return Trigger(at=now, reason=f"чат x{ratio:.1f} ({int(score)} за {self.window}с)", score=ratio)
        return None


class AudioPeakDetector:
    """Срабатывает, если средняя громкость куска заметно выше обычной."""

    def __init__(self, db_above: float = 8.0, history: int = 45, min_history: int = 10):
        self.db_above = db_above
        self.min_history = min_history
        self._levels: deque[float] = deque(maxlen=history)

    def add_level(self, mean_db: float, at: float) -> Trigger | None:
        trig = None
        if len(self._levels) >= self.min_history:
            base = statistics.median(self._levels)
            if mean_db - base >= self.db_above:
                trig = Trigger(at=at, reason=f"звук +{mean_db - base:.1f} dB", score=mean_db - base)
        self._levels.append(mean_db)
        return trig


_MEAN_RE = re.compile(r"mean_volume:\s*(-?[\d.]+|-inf) dB")


def parse_mean_volume(ffmpeg_stderr: str) -> float | None:
    m = _MEAN_RE.search(ffmpeg_stderr)
    if not m:
        return None
    return -91.0 if m.group(1) == "-inf" else float(m.group(1))
