"""Делает клип «как у клиперов»: субтитры, заголовок и вертикаль с лицом стримера сверху.

Всё необязательно: если на сервере нет faster-whisper, OpenCV или ключа ИИ,
клип всё равно получится, просто без этой части.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from hypecut.paths import FFMPEG

log = logging.getLogger(__name__)

ACCENT_ASS = "&H009DE52E"  # #2EE59D в формате ASS (BGR)
W, H = 1080, 1920


@dataclass
class Word:
    start: float
    end: float
    text: str


# ---------- речь ----------
_whisper = None


def _model():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        name = os.environ.get("WHISPER_MODEL", "small")
        _whisper = WhisperModel(name, device="cpu", compute_type="int8",
                                cpu_threads=int(os.environ.get("WHISPER_THREADS", "2")))
    return _whisper


def transcribe(video: Path) -> list[Word]:
    """Распознаёт речь в клипе с таймингом каждого слова. Пустой список, если whisper нет."""
    if os.environ.get("HYPECUT_SUBTITLES", "1") == "0":
        return []
    try:
        segments, _ = _model().transcribe(str(video), word_timestamps=True, vad_filter=True,
                                          beam_size=1, condition_on_previous_text=False)
        return [Word(w.start, w.end, w.word.strip()) for s in segments for w in (s.words or [])
                if w.word.strip()]
    except ImportError:
        return []
    except Exception:
        log.exception("Не получилось распознать речь в %s", video.name)
        return []


def _ts(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def _clean(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def chunks(words: list[Word], size: int = 3) -> list[list[Word]]:
    """Режет речь на короткие фразы по 2–3 слова; длинная пауза начинает новую фразу."""
    out: list[list[Word]] = []
    for w in words:
        if out and len(out[-1]) < size and w.start - out[-1][-1].end < 0.6:
            out[-1].append(w)
        else:
            out.append([w])
    return out


def write_ass(words: list[Word], out: Path, width: int = W, height: int = H, y: int | None = None) -> Path | None:
    """Крупные субтитры в стиле TikTok: белые слова, текущее слово зелёное."""
    if not words:
        return None
    y = y if y is not None else int(height * 0.62)
    size = int(width * 0.075)
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        "WrapStyle: 0", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Cap,DejaVu Sans,{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,"
        "1,0,0,0,100,100,0,0,1,6,2,5,60,60,0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for group in chunks(words):
        for i, w in enumerate(group):
            end = group[i + 1].start if i + 1 < len(group) else w.end + 0.25
            parts = [(f"{{\\c{ACCENT_ASS}}}" if j == i else "") + _clean(x.text).upper() +
                     ("{\\c&H00FFFFFF}" if j == i else "") for j, x in enumerate(group)]
            lines.append(f"Dialogue: 0,{_ts(w.start)},{_ts(end)},Cap,,0,0,0,,"
                         f"{{\\pos({width // 2},{y})}}" + " ".join(parts))
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


# ---------- лицо стримера ----------
@dataclass
class Layout:
    kind: str                      # split | follow | blur
    box: tuple[int, int, int, int] | None = None   # область вебки (x, y, w, h) в пикселях исходника
    cx: int | None = None          # центр лица по горизонтали для follow
    src_w: int = 0
    src_h: int = 0


def find_layout(video: Path, samples: int = 8) -> Layout:
    """Ищет лицо стримера на нескольких кадрах.

    Маленькое лицо в одном и том же месте значит вебку поверх игры: делаем «вебка сверху, игра снизу».
    Большое лицо значит разговорный стрим: кадр следует за лицом. Нет лица: размытый фон.
    """
    try:
        import cv2
        cv2.CascadeClassifier  # в OpenCV 5 каскады убрали, нужна версия 4.x
    except (ImportError, AttributeError):
        return Layout("blur")
    cap = cv2.VideoCapture(str(video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    sw, sh = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if not total or not sw or sw < sh:
        cap.release()
        return Layout("blur", src_w=sw, src_h=sh)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces: list[tuple[int, int, int, int]] = []
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(sh // 20, sh // 20))
        if len(found):
            faces.append(tuple(int(v) for v in max(found, key=lambda f: f[2] * f[3])))
    cap.release()
    if len(faces) < max(2, samples // 3):
        return Layout("blur", src_w=sw, src_h=sh)
    faces.sort(key=lambda f: f[2])
    x, y, w, h = faces[len(faces) // 2]           # медиана, чтобы случайные срабатывания не мешали
    cx, cy = x + w // 2, y + h // 2
    steady = sum(abs(f[0] + f[2] // 2 - cx) < w and abs(f[1] + f[3] // 2 - cy) < h for f in faces)
    if w * h > sw * sh * 0.03 or steady < len(faces) * 0.6:
        return Layout("follow", cx=cx, src_w=sw, src_h=sh)
    # вебка: берём область вокруг лица с запасом и пропорциями верхней части кадра (1080x640)
    bw = min(sw, int(w * 4.2))
    bh = min(sh, int(bw * 640 / 1080))
    bx = min(max(0, cx - bw // 2), sw - bw)
    by = min(max(0, cy - bh // 2), sh - bh)
    return Layout("split", box=(bx, by, bw - bw % 2, bh - bh % 2), src_w=sw, src_h=sh)


def vertical_graph(layout: Layout, width: int = W, height: int = H) -> tuple[str, int]:
    """Фильтр ffmpeg для вертикали width x height и высота, на которой ставить субтитры."""
    if layout.kind == "split" and layout.box:
        x, y, w, h = layout.box
        top = int(height / 3) // 2 * 2
        bottom = height - top
        graph = (f"[0:v]crop={w}:{h}:{x}:{y},scale={width}:{top}:force_original_aspect_ratio=increase,"
                 f"crop={width}:{top}[cam];"
                 f"[0:v]scale=-2:{bottom},crop={width}:{bottom}[game];"
                 "[cam][game]vstack=inputs=2,setsar=1[base]")
        return graph, top + int(height * 0.073)
    if layout.kind == "follow" and layout.cx is not None and layout.src_h:
        cw = int(layout.src_h * 9 / 16) // 2 * 2
        x = min(max(0, layout.cx - cw // 2), max(0, layout.src_w - cw))
        graph = f"[0:v]crop={cw}:{layout.src_h}:{x}:0,scale={width}:{height},setsar=1[base]"
        return graph, int(height * 0.72)
    graph = (f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},boxblur=20:5[bg];"
             f"[0:v]scale={width}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]")
    return graph, int(height * 0.74)


def size_for(h: int) -> tuple[int, int]:
    """Размер вертикали для качества: 720 -> 720x1280, 1080 -> 1080x1920, 1440 -> 1440x2560."""
    return h // 2 * 2, int(h * 16 / 9) // 2 * 2


# потолок битрейта, чтобы клип пролезал в лимит Telegram для ботов (50 МБ)
MAXRATE = {720: "3M", 1080: "6M", 1440: "8M"}


def rate_args(h: int) -> list[str]:
    cap = MAXRATE.get(h, "8M")
    return ["-maxrate", cap, "-bufsize", str(int(cap[:-1]) * 2) + "M"]


def _ass_path(p: Path) -> str:
    # в фильтре ffmpeg двоеточие и кавычки надо экранировать
    return p.resolve().as_posix().replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def make_vertical(src: Path, out: Path, words: list[Word] | None = None, height: int = 1080,
                  ss: float = 0.0, t: float | None = None) -> Path | None:
    """Вертикальная 9:16 версия: вебка сверху или кадр по лицу, плюс субтитры.

    height: качество (ширина вертикали), ss и t: с какой секунды и сколько взять из исходника.
    """
    layout = find_layout(src)
    vw, vh = size_for(height)
    graph, sub_y = vertical_graph(layout, vw, vh)
    shifted = [Word(w.start - ss, w.end - ss, w.text) for w in (words or [])
               if w.end > ss and (t is None or w.start < ss + t)]
    ass = write_ass(shifted, out.with_suffix(".ass"), vw, vh, y=sub_y)
    graph += f";[base]ass='{_ass_path(ass)}'[v]" if ass else ";[base]null[v]"
    cut = (["-ss", f"{ss:.2f}"] if ss else []) + (["-t", f"{t:.2f}"] if t else [])
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *cut, "-i", str(src),
                        "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", *rate_args(height),
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)],
                       capture_output=True)
    if ass:
        ass.unlink(missing_ok=True)
    if p.returncode != 0 or not out.exists():
        log.warning("Не получилось сделать вертикальную версию (%s): %s", layout.kind,
                    p.stderr.decode(errors="replace")[-300:])
        return None
    log.info("Вертикаль %s: %s %dx%d, субтитров %d слов", out.name, layout.kind, vw, vh, len(shifted))
    return out


def make_horizontal(src: Path, out: Path, height: int, ss: float = 0.0, t: float | None = None) -> Path | None:
    """Обычная 16:9 версия нужного качества и длины."""
    cut = (["-ss", f"{ss:.2f}"] if ss else []) + (["-t", f"{t:.2f}"] if t else [])
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *cut, "-i", str(src),
                        "-vf", f"scale=-2:{height},setsar=1", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "21", *rate_args(height), "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)], capture_output=True)
    if p.returncode != 0 or not out.exists():
        log.warning("Не получилось сделать %dp версию: %s", height, p.stderr.decode(errors="replace")[-300:])
        return None
    return out


def video_height(path: Path) -> int | None:
    """Высота кадра исходника (ffprobe лежит рядом с ffmpeg)."""
    ff = Path(FFMPEG)
    probe = str(ff.with_name(ff.name.replace("ffmpeg", "ffprobe")))
    try:
        p = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height",
                            "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=30)
        return int(p.stdout.strip().splitlines()[0])
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        return None


# ---------- заголовок ----------
_STOP = set("и в на не что это я ты он она мы вы они а но да нет ну так как the a an to of is it i you and "
            "lol lul kekw xd".split())


def simple_title(transcript: str, chat: list[str], reason: str) -> str:
    """Заголовок без ИИ: самая частая фраза из чата или кусок речи стримера."""
    msgs = [m.split(": ", 1)[-1].strip() for m in chat]
    counts = Counter(m.lower() for m in msgs if 1 < len(m) <= 40)
    if counts:
        top, n = counts.most_common(1)[0]
        if n >= 2:
            return f"Чат: «{top.upper()}» ×{n}"
    words = [w for w in re.findall(r"[\w'!?]+", transcript)]
    meaningful = [w for w in words if w.lower() not in _STOP]
    if len(meaningful) >= 3:
        phrase = " ".join(words[:8])
        return f"«{phrase[:60]}»"
    return reason or "Яркий момент"


def ai_title(channel: str, transcript: str, chat: list[str], reason: str) -> str | None:
    """Короткий цепляющий заголовок от Claude. Работает, только если задан ANTHROPIC_API_KEY."""
    if not os.environ.get("ANTHROPIC_API_KEY") or not (transcript or chat):
        return None
    try:
        import anthropic
    except ImportError:
        return None
    prompt = (
        "Ты пишешь заголовки для коротких клипов со стримов, как у популярных клиперов в TikTok.\n"
        f"Стример: {channel}\nПочему клип нарезан: {reason}\n"
        f"Что говорил стример: {transcript[:1500] or '(речи нет)'}\n"
        "Сообщения чата в этот момент:\n" + "\n".join(chat[-15:]) + "\n\n"
        "Напиши один заголовок до 60 символов на языке стримера. Без кавычек, хэштегов и эмодзи в начале. "
        "Не выдумывай того, чего нет в речи и чате. Ответь только заголовком."
    )
    try:
        client = anthropic.Anthropic(timeout=20, max_retries=1)
        resp = client.beta.messages.create(
            model=os.environ.get("HYPECUT_TITLE_MODEL", "claude-opus-5-5"),
            max_tokens=200,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIStatusError as e:
        log.warning("ИИ-заголовок: ошибка API %s", e.status_code)
        return None
    except anthropic.APIConnectionError:
        log.warning("ИИ-заголовок: нет связи с API")
        return None
    if resp.stop_reason == "refusal":
        return None
    text = "".join(b.text for b in resp.content if b.type == "text").strip().strip('"«»').splitlines()
    title = text[0].strip() if text else ""
    return title[:80] or None


def make_title(channel: str, transcript: str, chat: list[str], reason: str) -> str:
    return ai_title(channel, transcript, chat, reason) or simple_title(transcript, chat, reason)
