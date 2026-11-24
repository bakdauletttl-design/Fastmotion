"""Media Processing: длина и качество видео, громкость по секундам, нарезка клипа и превью. Всё через ffmpeg."""
from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

from .. import enhance

log = logging.getLogger(__name__)


def probe(path: Path) -> tuple[float, int | None]:
    """(длина в секундах, высота кадра)."""
    return enhance.video_duration(path), enhance.video_height(path)


def loudness(path: Path) -> list[float]:
    """Громкость (dB RMS) каждой секунды. Пустой список, если звука нет."""
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-ac", "1", "-af",
           "aresample=8000,asetnsamples=n=8000:p=0,astats=metadata=1:reset=1,"
           "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=1800).stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []
    vals = []
    for m in re.finditer(r"RMS_level=(-?[\d.]+|-inf)", out):
        v = m.group(1)
        vals.append(-90.0 if v == "-inf" else max(-90.0, float(v)))
    return vals


def cut(src: Path, start: float, end: float, out: Path, max_height: int = 1440) -> Path | None:
    """Кусок длинного видео в mp4 (H.264 + AAC), не выше max_height."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.2f}", "-i", str(src),
           "-t", f"{max(0.5, end - start):.2f}", "-vf", f"scale=-2:'min({max_height},ih)'",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "128k",
           "-movflags", "+faststart", str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        log.warning("Не получилось вырезать %s: %s", out.name, r.stderr[-300:])
        return None
    return out


def thumbnail(src: Path, at: float, out: Path) -> Path | None:
    r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{at:.2f}", "-i", str(src),
                        "-frames:v", "1", "-vf", "scale=640:-2", str(out)], capture_output=True)
    return out if r.returncode == 0 and out.exists() else None
