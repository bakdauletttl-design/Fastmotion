"""Облачная нарезка: один стрим записывается один раз, клипы рассылаются всем подписчикам канала."""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import time
from collections import deque
from datetime import datetime
from pathlib import Path

from hypecut.capture import StreamOffline, StreamRecorder
from hypecut.chat import chat_messages
from hypecut.clipper import build_clip, make_thumbnail, mean_volume
from hypecut.detector import AudioPeakDetector, ChatSpikeDetector, Trigger

from . import enhance
from .config import Config
from .db import DB
from .plans import can_receive
from .sources import Source, from_key
from .telegram_api import TelegramAPI

log = logging.getLogger(__name__)


async def make_vertical(src: Path, out: Path, words=None) -> Path | None:
    return await asyncio.to_thread(enhance.make_vertical, src, out, words)


class SourceRecorder(StreamRecorder):
    """Запись с любой площадки: сначала streamlink, а если он не справился, ссылку на поток даёт yt-dlp."""

    def __init__(self, source: Source, *args):
        super().__init__(source.name, *args)
        self.source = source

    def open_stream(self):
        from streamlink import Streamlink
        from streamlink.options import Options

        session = Streamlink()
        opts = Options({"disable-ads": True}) if self.source.platform == "twitch" else None
        streams = {}
        try:
            streams = session.streams(self.source.url, options=opts) if opts else session.streams(self.source.url)
        except Exception as e:
            log.info("streamlink не открыл %s: %s", self.source.key, e)
        if not streams:
            direct = _ytdlp_url(self.source.url)
            if not direct:
                raise StreamOffline()
            streams = session.streams(("hls://" if ".m3u8" in direct else "httpstream://") + direct)
            if not streams:
                raise StreamOffline()
        stream = streams.get(self.quality) or streams.get("best")
        return stream.open()


def _ytdlp_url(url: str) -> str | None:
    """Прямая ссылка на живой поток через yt-dlp (если он установлен)."""
    try:
        p = subprocess.run(["yt-dlp", "-g", "--no-warnings", "-f", "best", url],
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = [x for x in p.stdout.splitlines() if x.startswith("http")]
    return lines[0] if p.returncode == 0 and lines else None


class Dispatcher:
    """Рассылает готовый клип подписчикам канала с учётом их тарифа."""

    def __init__(self, cfg: Config, db: DB, api: TelegramAPI | None, push=None):
        self.cfg, self.db, self.api, self.push = cfg, db, api, push

    async def announce_live(self, channel: str) -> int:
        """Сообщает подписчикам, что стример вышел в эфир."""
        src = from_key(channel)
        name = src.name.lstrip("@")
        users = [u for u in self.db.followers(channel) if self.db.plan_of(u)]
        if self.api:
            for u in users:
                if u["telegram_chat_id"]:
                    await self.api.send_message(u["telegram_chat_id"],
                                                f"🔴 {name} в эфире на {src.title}. Ловлю лучшие моменты.")
        if self.push:
            await self.push.send([u["id"] for u in users], f"🔴 {name} в эфире",
                                 f"{src.title}: HypeCut уже смотрит стрим и пришлёт клипы", {"channel": channel})
        return len(users)

    def needs_vertical(self, channel: str) -> bool:
        for u in self.db.followers(channel):
            plan = self.db.plan_of(u)
            if plan and plan.vertical:
                return True
        return False

    async def deliver(self, clip_id: str) -> int:
        clip = self.db.clip(clip_id)
        if clip is None:
            return 0
        src = from_key(clip["channel"])
        head = f"🔥 {clip['title']}\n" if clip["title"] else ""
        caption = (f"{head}HypeCut · {src.name.lstrip('@')} ({src.title})\n{clip['reason']} · "
                   f"{datetime.fromtimestamp(clip['created']):%H:%M}\n{src.public()['url']}")
        got: list[int] = []
        for user in self.db.followers(clip["channel"]):
            plan = self.db.plan_of(user)
            if not can_receive(plan, self.db.received_in_stream(user["id"], clip["stream_id"])):
                continue
            ok = False
            if self.api and user["telegram_chat_id"]:
                vertical = bool(plan.vertical and clip["vertical_file"])
                col = "tg_vertical_file_id" if vertical else "tg_file_id"
                fname = clip["vertical_file"] if vertical else clip["file"]
                clip = self.db.clip(clip_id)  # file_id мог появиться после прошлой отправки
                ok, fid = await self.api.send_video(user["telegram_chat_id"], caption,
                                                    path=self.cfg.clips_dir / fname, file_id=clip[col])
                if ok and fid and not clip[col]:
                    self.db.set_clip(clip_id, **{col: fid})
            # клип в приложении виден в любом случае, даже если Telegram не ответил
            self.db.add_delivery(clip_id, user["id"], clip["stream_id"], ok)
            got.append(user["id"])
        if self.push and got:
            await self.push.send(got, f"🔥 {src.name.lstrip('@')}", clip["title"] or clip["reason"],
                                 {"clip": clip_id})
        return len(got)


class ChannelWorker:
    """Следит за одним каналом: ждёт эфир, пишет буфер, ловит всплески чата и звука, режет клипы."""

    def __init__(self, cfg: Config, db: DB, dispatcher: Dispatcher, channel: str, recorder=None):
        self.cfg, self.db, self.dispatcher, self.channel = cfg, db, dispatcher, channel
        self.source = from_key(channel)
        self.recorder = recorder or SourceRecorder(self.source, cfg.quality, cfg.buffers_dir / self.source.safe,
                                                   cfg.segment_seconds, cfg.buffer_seconds)
        self.chat = ChatSpikeDetector(cfg.chat_window, cfg.chat_multiplier, cfg.chat_min_messages, cfg.hype_words)
        self.audio = AudioPeakDetector(cfg.audio_db_above)
        self._last = 0.0
        self._announced: str | None = None
        self._tasks: list[asyncio.Task] = []
        self._pending: set[asyncio.Task] = set()
        self.messages: deque[tuple[float, str, str]] = deque(maxlen=2000)

    @property
    def stream_id(self) -> str:
        return f"{self.channel}_{int(self.recorder.started_at or 0)}"

    def start(self) -> None:
        self.recorder.on_segment(self._on_segment)
        self._tasks = [asyncio.create_task(self.recorder.run())]
        # чат пока читаем только на Twitch; на других площадках моменты ищутся по звуку
        if self.source.has_chat:
            self._tasks.append(asyncio.create_task(self._chat_loop()))
        log.info("Слежу за %s", self.channel)

    async def stop(self) -> None:
        for t in [*self._tasks, *self._pending]:
            t.cancel()
        await asyncio.gather(*self._tasks, *self._pending, return_exceptions=True)
        log.info("Перестал следить за %s", self.channel)

    async def _chat_loop(self) -> None:
        while True:
            # к чату подключаемся только во время эфира, чтобы не держать сотни лишних соединений
            while not self.recorder.live:
                await asyncio.sleep(5)
            stream = chat_messages(self.source.name)
            try:
                async for nick, text in stream:
                    now = time.time()
                    self.messages.append((now, nick, text))
                    trig = self.chat.add_message(text, now)
                    if trig:
                        self.fire(trig)
                    if not self.recorder.live:
                        break
            finally:
                await stream.aclose()

    async def _on_segment(self, seg) -> None:
        if self._announced != self.stream_id:
            self._announced = self.stream_id
            try:
                await self.dispatcher.announce_live(self.channel)
            except Exception:
                log.exception("Не удалось сообщить об эфире %s", self.channel)
        level = await mean_volume(seg.path)
        if level is None:
            return
        trig = self.audio.add_level(level, at=seg.end - seg.duration / 2)
        if trig:
            self.fire(trig)

    def fire(self, trig: Trigger) -> bool:
        if not self.recorder.live or trig.at - self._last < self.cfg.cooldown:
            return False
        self._last = trig.at
        task = asyncio.create_task(self.make_clip(trig))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)
        return True

    async def make_clip(self, trig: Trigger) -> str | None:
        cfg = self.cfg
        start, end = trig.at - cfg.pre_roll, trig.at + cfg.post_roll
        wait = end - time.time() + cfg.segment_seconds + 1
        if wait > 0:
            await asyncio.sleep(wait)
        segments = self.recorder.segments_between(start, end)
        if not segments:
            return None
        base = f"{self.source.safe}_{datetime.fromtimestamp(trig.at):%Y%m%d_%H%M%S}"
        clip_id, n = base, 2
        while self.db.clip(clip_id):
            clip_id, n = f"{base}_{n}", n + 1
        out = cfg.clips_dir / f"{clip_id}.mp4"
        try:
            await build_clip(segments, start, end, out)
        except Exception:
            log.exception("Не удалось собрать клип %s", clip_id)
            return None
        thumb = await make_thumbnail(out, out.with_suffix(".jpg"))
        chat = [f"{n}: {m}" for t, n, m in self.messages if trig.at - 12 <= t <= trig.at + 4][-8:]
        # речь стримера: для субтитров в вертикали и для заголовка
        words = await asyncio.to_thread(enhance.transcribe, out)
        transcript = " ".join(w.text for w in words)
        title = await asyncio.to_thread(enhance.make_title, self.source.name.lstrip("@"), transcript,
                                        chat, trig.reason)
        vertical = None
        if self.dispatcher.needs_vertical(self.channel):
            vertical = await make_vertical(out, out.with_name(f"{clip_id}_9x16.mp4"), words)
        self.db.add_clip(id=clip_id, channel=self.channel, stream_id=self.stream_id, file=out.name,
                         vertical_file=vertical.name if vertical else None,
                         thumb=thumb.name if thumb else None, reason=trig.reason, kind=trig.kind,
                         created=trig.at, duration=round(end - max(start, segments[0].start), 1),
                         moment=round(trig.at - max(start, segments[0].start), 1),
                         messages=json.dumps(chat, ensure_ascii=False), title=title,
                         transcript=transcript or None)
        count = await self.dispatcher.deliver(clip_id)
        log.info("Клип %s разослан %d подписчикам", clip_id, count)
        return clip_id


class Manager:
    """Держит запущенными воркеры ровно для тех каналов, на которые кто-то подписан с действующим тарифом."""

    def __init__(self, cfg: Config, db: DB, dispatcher: Dispatcher, worker_factory=None):
        self.cfg, self.db, self.dispatcher = cfg, db, dispatcher
        self.workers: dict[str, ChannelWorker] = {}
        self._factory = worker_factory or (lambda ch: ChannelWorker(cfg, db, dispatcher, ch))
        self._wake = asyncio.Event()

    def status(self, key: str) -> dict:
        """Идёт ли сейчас эфир у канала и сколько клипов сделано за последние 12 часов."""
        w = self.workers.get(key)
        return {"live": bool(w and w.recorder.live),
                "clips_recent": self.db.clips_since(key, time.time() - 12 * 3600)}

    def poke(self) -> None:
        self._wake.set()

    async def reconcile(self) -> None:
        wanted = [ch for ch, _ in self.db.wanted_channels()][: self.cfg.max_streams]
        for ch in list(self.workers):
            if ch not in wanted:
                await self.workers.pop(ch).stop()
        for ch in wanted:
            if ch not in self.workers:
                w = self._factory(ch)
                w.start()
                self.workers[ch] = w

    def cleanup(self) -> int:
        """Удаляет файлы старых клипов: в Telegram они уже есть, место на сервере не бесконечное."""
        removed = 0
        for c in self.db.old_clips(time.time() - self.cfg.clip_keep_days * 86400):
            for name in (c["file"], c["vertical_file"], c["thumb"]):
                if name:
                    (self.cfg.clips_dir / name).unlink(missing_ok=True)
            self.db.delete_clip(c["id"])
            removed += 1
        return removed

    async def run(self) -> None:
        last_cleanup = 0.0
        try:
            while True:
                try:
                    await self.reconcile()
                    if time.time() - last_cleanup > 3600:
                        self.cleanup()
                        last_cleanup = time.time()
                except Exception:
                    log.exception("Ошибка менеджера каналов")
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=30)
                except asyncio.TimeoutError:
                    pass
        finally:
            for w in self.workers.values():
                await w.stop()
