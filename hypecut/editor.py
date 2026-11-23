"""Монтаж: обрезка клипов и склейка нескольких отрезков в один ролик."""
from __future__ import annotations

import asyncio
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .paths import FFMPEG, NO_WINDOW

_SIZE_RE = re.compile(r"Video:.*?(\d{2,5})x(\d{2,5})")
_DUR_RE = re.compile(r"Duration:\s*(\d+):(\d+):([\d.]+)")
_AUDIO_RE = re.compile(r"Stream #\d+:\d+.*Audio:")


@dataclass
class Piece:
    path: Path
    start: float  # секунда внутри файла
    end: float


def probe(path: Path) -> dict:
    """Размер кадра, длительность и наличие звука (через вывод ffmpeg -i, без ffprobe)."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, **NO_WINDOW)
    err = p.stderr.decode(errors="replace")
    info: dict = {"width": 1280, "height": 720, "duration": 0.0, "audio": bool(_AUDIO_RE.search(err))}
    if m := _SIZE_RE.search(err):
        info["width"], info["height"] = int(m.group(1)), int(m.group(2))
    if m := _DUR_RE.search(err):
        info["duration"] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    return info


def build_command(pieces: list[Piece], out: Path, width: int, height: int) -> list[str]:
    """Каждый отрезок приводится к одному размеру, частоте и звуку, затем склеивается."""
    args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
    for p in pieces:
        args += ["-ss", f"{p.start:.3f}", "-t", f"{max(0.1, p.end - p.start):.3f}", "-i", str(p.path)]
    # тишина на случай, если у какого-то отрезка нет звука
    args += ["-f", "lavfi", "-t", "3600", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    silence = len(pieces)

    filters, chain = [], ""
    for i, p in enumerate(pieces):
        filters.append(
            f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v{i}]")
        dur = max(0.1, p.end - p.start)
        src = f"{i}:a" if probe_has_audio(p.path) else f"{silence}:a"
        filters.append(
            f"[{src}]aformat=sample_rates=48000:channel_layouts=stereo,"
            f"atrim=0:{dur:.3f},asetpts=PTS-STARTPTS[a{i}]")
        chain += f"[v{i}][a{i}]"
    filters.append(f"{chain}concat=n={len(pieces)}:v=1:a=1[v][a]")
    args += ["-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)]
    return args


_audio_cache: dict[str, bool] = {}


def probe_has_audio(path: Path) -> bool:
    key = str(path)
    if key not in _audio_cache:
        _audio_cache[key] = probe(path)["audio"]
    return _audio_cache[key]


def _render_sync(pieces: list[Piece], out: Path) -> Path:
    if not pieces:
        raise ValueError("Нет отрезков для монтажа")
    out.parent.mkdir(parents=True, exist_ok=True)
    first = probe(pieces[0].path)
    w, h = first["width"] - first["width"] % 2, first["height"] - first["height"] % 2
    p = subprocess.run(build_command(pieces, out, w, h), capture_output=True, **NO_WINDOW)
    if p.returncode != 0 or not out.exists():
        raise RuntimeError("ffmpeg: " + p.stderr.decode(errors="replace")[-400:])
    return out


async def render(pieces: list[Piece], out: Path) -> Path:
    return await asyncio.to_thread(_render_sync, pieces, out)
