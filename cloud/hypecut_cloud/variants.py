"""Версии клипа под тарифы: качество (720p / 1080p / 2K), длина (обычная или длинная для Max), 16:9 или 9:16.

Стрим режется один раз в лучшем нужном качестве, а версии делаются по запросу и кэшируются на диске.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

from . import enhance
from .plans import Plan

log = logging.getLogger(__name__)
TG_LIMIT = 49 * 1024 * 1024  # боты Telegram отправляют видео до 50 МБ


@dataclass(frozen=True)
class Want:
    height: int
    long: bool
    vertical: bool
    watermark: bool = False  # тариф Free: надпись HypeCut в углу


def want_for(plan: Plan, clip, vertical: bool | None = None) -> Want:
    src_h = clip["height"] or plan.height
    return Want(min(plan.height, src_h), plan.long_clips,
                plan.vertical if vertical is None else (vertical and plan.vertical), plan.watermark)


def name_for(clip_id: str, w: Want) -> str:
    return f"{clip_id}.v{w.height}{'L' if w.long else ''}{'_9x16' if w.vertical else ''}{'W' if w.watermark else ''}.mp4"


def add_watermark(path: Path) -> Path | None:
    """Надпись HypeCut в правом нижнем углу (тариф Free)."""
    import subprocess
    tmp = path.with_suffix(".wm.mp4")
    r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(path), "-vf",
                        "drawtext=text='HypeCut':fontcolor=white@0.75:fontsize=h/28:x=w-tw-h/40:y=h-th-h/40:"
                        "shadowcolor=black@0.5:shadowx=2:shadowy=2", "-c:a", "copy", str(tmp)], capture_output=True)
    if r.returncode != 0:
        log.warning("Водяной знак не добавился: %s", r.stderr[-200:])
        tmp.unlink(missing_ok=True)
        return path
    tmp.replace(path)
    return path


def lengths(clip, long: bool) -> tuple[float, float | None]:
    """С какой секунды и сколько брать из исходника для обычной или длинной версии."""
    if long:
        return 0.0, None
    ss, cut_end = clip["trim_start"] or 0.0, clip["trim_end"] or 0.0
    t = (clip["duration"] or 0) - ss - cut_end
    return ss, (t if (ss or cut_end) and t > 0 else None)


def duration_for(clip, long: bool) -> float:
    ss, t = lengths(clip, long)
    return round(t if t is not None else (clip["duration"] or 0) - ss, 1)


def moment_for(clip, long: bool) -> float | None:
    if clip["moment"] is None:
        return None
    return round(clip["moment"] - (0 if long else (clip["trim_start"] or 0)), 1)


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(out: Path) -> threading.Lock:
    """Один замок на каждый файл версии: два запроса не делают один и тот же файл одновременно."""
    with _locks_guard:
        return _locks.setdefault(str(out), threading.Lock())


def path_for(clips_dir: Path, clip, w: Want) -> Path | None:
    """Готовый файл нужной версии; делает его, если ещё нет. None, если исходник уже удалён.

    Файл сначала пишется во временный и только готовым переименовывается в настоящее имя.
    Раньше плеер браузера (он шлёт несколько запросов сразу) и отправка в Telegram запускали
    ffmpeg одновременно в один и тот же файл, и получалось битое видео: «ошибка воспроизведения»."""
    out = clips_dir / name_for(clip["id"], w)
    if out.exists():
        return out
    with _lock_for(out):
        if out.exists():  # пока ждали замок, файл сделал другой запрос
            return out
        tmp = clips_dir / f".tmp_{uuid.uuid4().hex[:8]}_{out.name}"
        try:
            made = _render(clips_dir, clip, w, tmp)
            if made is None or not made.exists() or made.stat().st_size == 0:
                return None
            os.replace(made, out)
            return out
        finally:
            tmp.unlink(missing_ok=True)


def _render(clips_dir: Path, clip, w: Want, out: Path) -> Path | None:
    if w.watermark:
        base = path_for(clips_dir, clip, Want(w.height, w.long, w.vertical))
        if base is None:
            return None
        shutil.copyfile(base, out)
        return add_watermark(out)
    src = clips_dir / clip["file"]
    if not src.exists():
        return None
    ss, t = lengths(clip, w.long)
    if w.vertical:
        words = [enhance.Word(*x) for x in json.loads(clip["words"] or "[]")]
        return enhance.make_vertical(src, out, words, w.height, ss, t, title=clip["title"],
                                     moment=moment_for(clip, w.long))
    if w.height == (clip["height"] or w.height) and not ss and t is None:
        shutil.copyfile(src, out)  # исходник уже в нужном качестве и длине
        return out
    return enhance.make_horizontal(src, out, w.height, ss, t)


def for_telegram(clips_dir: Path, clip, w: Want) -> tuple[Path | None, Want]:
    """Версия, которая пролезает в лимит Telegram: если 2K слишком тяжёлый, берём качество ниже."""
    for h in sorted({w.height, 1080, 720}, reverse=True):
        if h > w.height:
            continue
        cand = Want(h, w.long, w.vertical, w.watermark)
        p = path_for(clips_dir, clip, cand)
        if p and p.stat().st_size <= TG_LIMIT:
            return p, cand
    return None, w


def all_files(clips_dir: Path, clip_id: str) -> list[Path]:
    return list(clips_dir.glob(f"{clip_id}.v*.mp4"))
