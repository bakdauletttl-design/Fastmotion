"""Версии клипа под тарифы: качество (720p / 1080p / 2K), длина (обычная или длинная для Max), 16:9 или 9:16.

Стрим режется один раз в лучшем нужном качестве, а версии делаются по запросу и кэшируются на диске.
"""
from __future__ import annotations

import json
import logging
import shutil
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


def want_for(plan: Plan, clip, vertical: bool | None = None) -> Want:
    src_h = clip["height"] or plan.height
    return Want(min(plan.height, src_h), plan.long_clips,
                plan.vertical if vertical is None else (vertical and plan.vertical))


def name_for(clip_id: str, w: Want) -> str:
    return f"{clip_id}.v{w.height}{'L' if w.long else ''}{'_9x16' if w.vertical else ''}.mp4"


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


def path_for(clips_dir: Path, clip, w: Want) -> Path | None:
    """Готовый файл нужной версии; делает его, если ещё нет. None, если исходник уже удалён."""
    src = clips_dir / clip["file"]
    out = clips_dir / name_for(clip["id"], w)
    if out.exists():
        return out
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
        cand = Want(h, w.long, w.vertical)
        p = path_for(clips_dir, clip, cand)
        if p and p.stat().st_size <= TG_LIMIT:
            return p, cand
    return None, w


def all_files(clips_dir: Path, clip_id: str) -> list[Path]:
    return list(clips_dir.glob(f"{clip_id}.v*.mp4"))
