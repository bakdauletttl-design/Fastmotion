"""Сборка клипа из кусков буфера и вспомогательные вызовы ffmpeg."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from .capture import Segment
from .detector import parse_mean_volume


async def _run(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    return proc.returncode or 0, err.decode(errors="replace")


async def mean_volume(path: Path) -> float | None:
    """Средняя громкость куска в dB (через фильтр volumedetect)."""
    _, err = await _run("ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
                        "-vn", "-af", "volumedetect", "-f", "null", "-")
    return parse_mean_volume(err)


async def build_clip(segments: list[Segment], start: float, end: float, out: Path) -> Path:
    """Склеивает куски и обрезает до [start, end] (unix time). Без перекодирования видео."""
    if not segments:
        raise ValueError("Нет кусков для клипа")
    out.parent.mkdir(parents=True, exist_ok=True)
    offset = max(0.0, start - segments[0].start)
    duration = end - max(start, segments[0].start)

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        for s in segments:
            f.write(f"file '{s.path.resolve()}'\n")
        list_path = Path(f.name)
    try:
        code, err = await _run(
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_path),
            "-ss", f"{offset:.2f}", "-t", f"{duration:.2f}",
            "-c", "copy", "-movflags", "+faststart", str(out))
    finally:
        list_path.unlink(missing_ok=True)
    if code != 0 or not out.exists():
        raise RuntimeError(f"ffmpeg не смог собрать клип: {err[-400:]}")
    return out


async def make_thumbnail(video: Path, out: Path) -> Path | None:
    code, _ = await _run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                         "-ss", "1", "-i", str(video), "-frames:v", "1",
                         "-vf", "scale=480:-2", str(out))
    return out if code == 0 and out.exists() else None
