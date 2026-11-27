"""Сборка клипа из кусков буфера и вспомогательные вызовы ffmpeg."""
from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path

from .capture import Segment
from .detector import parse_mean_volume
from .paths import FFMPEG, NO_WINDOW


def _run_sync(args: list[str]) -> tuple[int, str]:
    p = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.PIPE, **NO_WINDOW)
    return p.returncode, p.stderr.decode(errors="replace")


async def _run(*args: str) -> tuple[int, str]:
    # обычный subprocess в потоке: так работает с любым event loop, в том числе на Windows
    return await asyncio.to_thread(_run_sync, [FFMPEG, *args])


async def mean_volume(path: Path) -> float | None:
    """Средняя громкость куска в dB (через фильтр volumedetect)."""
    _, err = await _run("-hide_banner", "-nostats", "-i", str(path),
                        "-vn", "-af", "volumedetect", "-f", "null", "-")
    return parse_mean_volume(err)


def _ffprobe() -> str | None:
    ff = Path(FFMPEG)
    probe = ff.with_name(ff.name.replace("ffmpeg", "ffprobe"))
    if probe.name != ff.name and probe.exists():
        return str(probe)
    import shutil
    return shutil.which("ffprobe")


def keyframes(path: Path) -> list[float] | None:
    """Где в куске ключевые кадры (секунды от начала куска). None, если ffprobe нет или кусок не читается."""
    probe = _ffprobe()
    if not probe:
        return None
    try:
        p = subprocess.run([probe, "-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, timeout=20, **NO_WINDOW)
        base = float(p.stdout.strip().splitlines()[0])
        p = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags",
                            "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=20, **NO_WINDOW)
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        return None
    out = []
    for line in p.stdout.splitlines():
        parts = line.split(",")
        if len(parts) >= 2 and parts[1].startswith("K") and parts[0] not in ("", "N/A"):
            out.append(max(0.0, float(parts[0]) - base))
    return sorted(out) or None


# у ключевого кадра время декодирования чуть раньше времени показа (B-кадры): берём с запасом
KEYFRAME_LEAD = 0.1


def snap_to_keyframe(offset: float, frames: list[float] | None) -> float:
    """Начало клипа переносится на ключевой кадр не позже offset.

    Без этого ffmpeg при -c copy выкидывает видео до следующего ключевого кадра,
    и первые 1–2 секунды клипа идут со звуком, но без картинки."""
    if not frames:
        return offset
    before = [k for k in frames if k <= offset + 0.02]
    return before[-1] if before else offset


async def build_clip(segments: list[Segment], start: float, end: float, out: Path,
                     info: dict | None = None) -> Path:
    """Склеивает куски и обрезает до [start, end] (unix time). Без перекодирования видео.

    Начало сдвигается назад на ближайший ключевой кадр (до 2 с на Twitch), чтобы видео
    было с первой секунды. Настоящее начало кладётся в info["start"] (unix time)."""
    if not segments:
        raise ValueError("Нет кусков для клипа")
    if not end > start:
        raise ValueError("Конец клипа должен быть позже начала")
    out.parent.mkdir(parents=True, exist_ok=True)
    first = segments[0]
    offset = max(0.0, start - first.start)
    frames = await asyncio.to_thread(keyframes, first.path) if offset > 0 else None
    snapped = snap_to_keyframe(offset, frames)
    # если ключевой кадр нашли, -ss ставим чуть раньше него: ffmpeg начнёт ровно с этого кадра
    ss = max(0.0, snapped - KEYFRAME_LEAD) if frames else offset
    real_start = first.start + (snapped if frames else offset)
    duration = end - first.start - ss
    if info is not None:
        info["start"] = real_start

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        for s in segments:
            p = s.path.resolve().as_posix().replace("'", r"'\''")
            f.write(f"file '{p}'\n")
        list_path = Path(f.name)
    try:
        code, err = await _run(
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_path),
            *(["-ss", f"{ss:.3f}"] if ss > 0 else []), "-t", f"{duration:.3f}",
            "-c", "copy", "-movflags", "+faststart", str(out))
    finally:
        list_path.unlink(missing_ok=True)
    if code != 0 or not out.exists():
        raise RuntimeError(f"ffmpeg не смог собрать клип: {err[-400:]}")
    return out


async def make_thumbnail(video: Path, out: Path) -> Path | None:
    code, _ = await _run("-hide_banner", "-loglevel", "error", "-y",
                         "-ss", "1", "-i", str(video), "-frames:v", "1",
                         "-vf", "scale=480:-2", str(out))
    return out if code == 0 and out.exists() else None
