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


HOOK_ASS = "&H0000E5FF"  # жёлтый, как у клиперов: заголовок-крючок в первые секунды


FONTS_DIR = Path(__file__).parent / "fonts"
# шрифты для субтитров и заголовка (все с кириллицей); ширина: насколько уменьшить, чтобы влезло
FONTS: dict[str, tuple[str, float]] = {
    "classic": ("DejaVu Sans", 1.0),
    "russo": ("Russo One", 1.0),
    "rubik": ("Rubik Mono One", 0.78),
    "lobster": ("Lobster", 1.1),
    "pixel": ("Press Start 2P", 0.62),
}


def write_ass(words: list[Word], out: Path, width: int = W, height: int = H, y: int | None = None,
              hook: str | None = None, hook_y: int | None = None, hook_seconds: float = 3.0,
              font: str = "classic") -> Path | None:
    """Крупные субтитры в стиле TikTok: белые слова, текущее слово зелёное.

    hook: заголовок клипа крупными жёлтыми буквами в первые секунды, чтобы зритель не пролистал.
    """
    if not words and not hook:
        return None
    y = y if y is not None else int(height * 0.62)
    face, k = FONTS.get(font, FONTS["classic"])
    size = int(width * 0.08 * k)
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        "WrapStyle: 0", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Cap,{face},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,"
        "1,0,0,0,100,100,0,0,1,6,2,5,60,60,0,1",
        f"Style: Hook,{face},{int(width * 0.082 * k)},{HOOK_ASS},{HOOK_ASS},&H00000000,&H64000000,"
        f"1,0,0,0,100,100,0,0,1,{max(4, width // 120)},3,5,{int(width * 0.04)},{int(width * 0.04)},0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    if hook:
        hy = hook_y if hook_y is not None else int(height * 0.2)
        # pop-эффект: заголовок «выпрыгивает» за 0.15 секунды
        lines.append(f"Dialogue: 1,{_ts(0)},{_ts(hook_seconds)},Hook,,0,0,0,,"
                     f"{{\\an5\\pos({width // 2},{hy})\\fscx70\\fscy70\\t(0,150,\\fscx100\\fscy100)}}"
                     + _clean(hook).upper())
    for group in chunks(words):
        if hook and group[-1].end <= hook_seconds:
            continue  # пока висит заголовок, субтитры не мешают
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
    face: tuple[int, int, int, int] | None = None  # само лицо стримера
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
    detect = _face_detector(cv2, sw, sh)
    # все лица на каждом кадре: вебка стоит на месте, а лица в игре и в мемах появляются и исчезают
    seen: list[list[tuple[int, int, int, int]]] = []
    grays = []
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
        ok, frame = cap.read()
        if not ok:
            continue
        seen.append(detect(frame))
        grays.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
    cap.release()
    layout = pick_layout(seen, sw, sh, samples)
    if layout.kind == "split" and layout.box and grays:
        layout.box = snap_to_webcam(cv2, grays, layout.box, layout.face, sw, sh)
    return layout


def snap_to_webcam(cv2, grays, box, face, sw: int, sh: int):
    """Подгоняет рамку под края самой вебки.

    Края вебки стоят на месте во всех кадрах, а игра под ними двигается, поэтому
    усредняем резкие перепады яркости по кадрам и ищем самые сильные линии вокруг лица.
    """
    import numpy as np
    fx, fy, fw, fh = face
    gx = np.mean([np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)) for g in grays], axis=0)
    gy = np.mean([np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)) for g in grays], axis=0)
    def strongest(profile, lo, hi, outer: bool):
        lo, hi = max(1, int(lo)), min(len(profile) - 1, int(hi))
        if hi <= lo:
            return None
        seg = profile[lo:hi]
        bar = 2.5 * (float(np.median(profile)) + 1e-3)
        peaks = [i for i in range(len(seg)) if seg[i] > bar and seg[i] >= seg[max(0, i - 2):i + 3].max()]
        if not peaks:
            return None
        # самая сильная линия; при равенстве берём дальнюю от лица: внутри вебки тоже бывают линии
        best = max(peaks, key=lambda i: (round(float(seg[i]) / bar, 1), i if outer else -i))
        return lo + best

    # 1) верх и низ: горизонтальные линии над и под лицом
    c0, c1 = max(0, fx - fw), min(sw, fx + 2 * fw)
    rows = gy[:, c0:c1].mean(axis=1)
    top = strongest(rows, fy - 4 * fh, fy - fh * 0.2, outer=False)
    bottom = strongest(rows, fy + fh * 1.2, fy + 5 * fh, outer=True)
    y0 = top if top is not None else (0 if fy < 2 * fh else box[1])
    y1 = bottom if bottom is not None else (sh if fy + fh > sh - 2 * fh else box[1] + box[3])
    # 2) лево и право: вертикальные линии, которые идут через всю высоту вебки
    cols = gx[y0:y1].mean(axis=0) if y1 > y0 else gx.mean(axis=0)
    span = (y1 - y0) * 2.2  # вебка редко шире, чем 2.2 своей высоты
    left = strongest(cols, fx + fw - span, fx - fw * 0.3, outer=False)
    right = strongest(cols, fx + fw * 1.3, (left if left is not None else fx) + span, outer=True)
    x0 = left if left is not None else (0 if fx < 2 * fw else box[0])
    x1 = right if right is not None else (sw if fx + fw > sw - 2 * fw else box[0] + box[2])
    w, h = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
    if w < fw * 2 or h < fh * 1.5:
        return box
    return (int(x0) + 2, int(y0) + 2, int(w) - 4, int(h) - 4)  # пара пикселей внутрь, чтобы не попала рамка


YUNET = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"


def _face_detector(cv2, sw: int, sh: int):
    """Нейросеть YuNet находит даже маленькие лица в наушниках и очках; если её нет, берём старый Haar."""
    scale = min(1.0, 960 / sw)
    iw, ih = int(sw * scale), int(sh * scale)
    if YUNET.exists() and hasattr(cv2, "FaceDetectorYN"):
        net = cv2.FaceDetectorYN.create(str(YUNET), "", (iw, ih), 0.6, 0.3, 50)

        def yunet(frame):
            _, faces = net.detect(cv2.resize(frame, (iw, ih)) if scale < 1 else frame)
            return [tuple(int(v / scale) for v in f[:4]) for f in (faces if faces is not None else [])]
        return yunet
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    def haar(frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(sh // 25, sh // 25))
        return [tuple(int(v) for v in f) for f in found]
    return haar


def pick_layout(seen: list[list[tuple[int, int, int, int]]], sw: int, sh: int, samples: int) -> Layout:
    """Выбирает раскладку по лицам на кадрах: самое «постоянное» лицо считается стримером."""
    clusters: list[dict] = []  # центр, список рамок, на скольких кадрах
    for frame_faces in seen:
        hit: set[int] = set()
        for f in frame_faces:
            cx, cy = f[0] + f[2] / 2, f[1] + f[3] / 2
            for k, c in enumerate(clusters):
                if k not in hit and abs(cx - c["cx"]) < max(f[2], sw * 0.04) and abs(cy - c["cy"]) < max(f[3], sh * 0.06):
                    c["boxes"].append(f)
                    c["frames"] += 1
                    hit.add(k)
                    break
            else:
                clusters.append({"cx": cx, "cy": cy, "boxes": [f], "frames": 1})
                hit.add(len(clusters) - 1)
    need = max(2, int(samples * 0.4))
    steady = [c for c in clusters if c["frames"] >= need]
    if not steady:
        return Layout("blur", src_w=sw, src_h=sh)
    best = max(steady, key=lambda c: (c["frames"], -abs(c["cx"] - sw / 2)))
    boxes = sorted(best["boxes"], key=lambda f: f[2])
    x, y, w, h = boxes[len(boxes) // 2]  # медиана, чтобы случайные срабатывания не мешали
    cx, cy = x + w // 2, y + h // 2
    if w * h > sw * sh * 0.03:
        return Layout("follow", cx=cx, src_w=sw, src_h=sh)  # разговорный стрим: лицо крупно
    # вебка поверх игры: область вокруг лица (и соседних лиц, если в кадре двое) с пропорциями верха вертикали
    x0, y0, x1, y1 = x, y, x + w, y + h
    for c in clusters:
        if c is not best and c["frames"] >= 2 and abs(c["cx"] - cx) < w * 5 and abs(c["cy"] - cy) < h * 4:
            bx_, by_, bw_, bh_ = sorted(c["boxes"], key=lambda f: f[2])[len(c["boxes"]) // 2]
            x0, y0, x1, y1 = min(x0, bx_), min(y0, by_), max(x1, bx_ + bw_), max(y1, by_ + bh_)
    ccx, ccy = (x0 + x1) // 2, (y0 + y1) // 2
    bw = min(sw, max(int(w * 6), int((x1 - x0) * 2.2)))
    bh = min(sh, int(bw * 640 / 1080))
    bx = min(max(0, ccx - bw // 2), sw - bw)
    by = min(max(0, ccy - int(bh * 0.45)), sh - bh)
    return Layout("split", box=(bx, by, bw - bw % 2, bh - bh % 2), src_w=sw, src_h=sh, face=(x, y, w, h))


def vertical_graph(layout: Layout, width: int = W, height: int = H, moment: float | None = None) -> tuple[str, int]:
    """Фильтр ffmpeg для вертикали width x height (с наездом на момент) и высота, на которой ставить субтитры."""
    if layout.kind == "split" and layout.box:
        x, y, w, h = layout.box
        top = int(height / 3) // 2 * 2
        bottom = height - top
        graph = (f"[0:v]crop={w}:{h}:{x}:{y},scale={width}:{top}:force_original_aspect_ratio=increase,"
                 f"crop={width}:{top}[cam];"
                 f"[0:v]scale=-2:{bottom},crop={width}:{bottom},{punch_in(width, bottom, moment)}[game];"
                 "[cam][game]vstack=inputs=2,setsar=1[base]")
        return graph, top + int(height * 0.073)
    if layout.kind == "follow" and layout.cx is not None and layout.src_h:
        cw = int(layout.src_h * 9 / 16) // 2 * 2
        x = min(max(0, layout.cx - cw // 2), max(0, layout.src_w - cw))
        graph = (f"[0:v]crop={cw}:{layout.src_h}:{x}:0,scale={width}:{height},"
                 f"{punch_in(width, height, moment)},setsar=1[base]")
        return graph, int(height * 0.72)
    graph = (f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},boxblur=20:5[bg];"
             f"[0:v]scale={width}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,{punch_in(width, height, moment)},"
             "setsar=1[base]")
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


def punch_in(vw: int, vh: int, at: float | None, zoom: float = 0.12, length: float = 1.6) -> str:
    """Резкий наезд камеры на самом моменте, как делают клиперы. Пустая строка, если момент неизвестен."""
    if at is None or at < 0:
        return "null"
    a, b = max(0.0, at - 0.2), at + length
    k = f"(1+{zoom}*between(t,{a:.2f},{b:.2f}))"
    return (f"scale=w='trunc({vw}*{k}/2)*2':h='trunc({vh}*{k}/2)*2':eval=frame,"
            f"crop={vw}:{vh}:(iw-{vw})/2:(ih-{vh})/2,setsar=1")


def make_vertical(src: Path, out: Path, words: list[Word] | None = None, height: int = 1080,
                  ss: float = 0.0, t: float | None = None, title: str | None = None,
                  moment: float | None = None, font: str = "classic", shift_words: bool = True) -> Path | None:
    """Вертикальная 9:16 версия в стиле клиперов.

    Вебка сверху и игра снизу (или кадр по лицу), заголовок-крючок в начале, субтитры по словам,
    наезд камеры на самом моменте. height: качество (ширина вертикали); ss и t: с какой секунды
    и сколько взять из исходника; moment: секунда момента внутри готового клипа.
    """
    layout = find_layout(src)
    vw, vh = size_for(height)
    graph, sub_y = vertical_graph(layout, vw, vh, moment)
    hook_y = sub_y - int(vh * 0.073) if layout.kind == "split" else int(vh * 0.2)
    if layout.kind == "split":
        sub_y = hook_y + int((vh - hook_y) * 0.42)  # субтитры посередине игры, как в примерах
    d = ss if shift_words else 0.0  # слова из редактора уже в секундах готового клипа
    shifted = [Word(w.start - d, w.end - d, w.text) for w in (words or [])
               if w.end > d and (t is None or w.start < d + t)]
    ass = write_ass(shifted, out.with_suffix(".ass"), vw, vh, y=sub_y, hook=title, hook_y=hook_y, font=font)
    graph += f";[base]ass='{_ass_path(ass)}':fontsdir='{_ass_path(FONTS_DIR)}'[v]" if ass else ";[base]null[v]"
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


TRANSITIONS = {"fade": "fade", "slide": "slideleft", "zoom": "zoomin", "wipe": "wipeup", "flash": "fadewhite"}


def video_duration(path: Path) -> float:
    ff = Path(FFMPEG)
    probe = str(ff.with_name(ff.name.replace("ffmpeg", "ffprobe")))
    try:
        p = subprocess.run([probe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, timeout=30)
        return float(p.stdout.strip())
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 0.0


def concat(parts: list[Path], out: Path, transition: str = "none", fade: float = 0.4) -> Path | None:
    """Склейка кусков в один ролик (хайлайты), с переходом между кусками или без.
    Куски уже одного размера, звук выравниваем."""
    inputs = [x for p in parts for x in ("-i", str(p))]
    n = len(parts)
    prep = "".join(f"[{i}:v:0]setsar=1,fps=30,format=yuv420p[v{i}];[{i}:a:0]aresample=44100[a{i}];" for i in range(n))
    kind = TRANSITIONS.get(transition)
    durs = [video_duration(p) for p in parts] if kind and n > 1 else []
    if kind and n > 1 and all(d > fade * 2 for d in durs):
        # xfade: каждый следующий кусок наезжает на конец предыдущего
        graph, v, a, offset = prep, "v0", "a0", 0.0
        for i in range(1, n):
            offset += durs[i - 1] - fade
            graph += (f"[{v}][v{i}]xfade=transition={kind}:duration={fade}:offset={offset:.3f}[x{i}];"
                      f"[{a}][a{i}]acrossfade=d={fade}[y{i}];")
            v, a = f"x{i}", f"y{i}"
        graph += f"[{v}]null[v];[{a}]anull[a]"
    else:
        graph = prep + "".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph,
                        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)],
                       capture_output=True)
    if p.returncode != 0 or not out.exists():
        log.warning("Не получилось склеить хайлайты: %s", p.stderr.decode(errors="replace")[-300:])
        return None
    return out


def decorate(src: Path, out: Path, music: Path | None = None, music_volume: float = 0.35,
             overlay: Path | None = None, overlay_pos: str = "top") -> Path | None:
    """Своя музыка под клипом и/или своё видео поверх: крупно сверху по центру или маленьким окном в углу."""
    if not music and not overlay:
        return None
    inputs, graph = ["-i", str(src)], []
    vmap, amap, venc = "0:v", "0:a?", ["-c:v", "copy"]
    n = 1
    if overlay:
        inputs += ["-stream_loop", "-1", "-i", str(overlay)]
        part, pos = (0.6, "(W-w)/2:H*0.04") if overlay_pos == "top" else (0.34, "W-w-W*0.04:H*0.04")
        # ширина окна от ширины клипа, высота по пропорциям вставки
        graph.append(f"[{n}:v][0:v]scale2ref=w=main_w*{part}:h=ow/mdar[ov][base];"
                     f"[base][ov]overlay={pos}:shortest=1,format=yuv420p[v]")
        vmap, venc = "[v]", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"]
        n += 1
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]
        vol = max(0.0, min(float(music_volume), 1.0))
        graph.append(f"[{n}:a]volume={vol:.2f}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]")
        amap = "[a]"
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(graph),
           "-map", vmap, "-map", amap, *venc, "-c:a", "aac", "-b:a", "128k", "-t", f"{video_duration(src):.3f}",
           "-movflags", "+faststart", str(out)]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0 or not out.exists():
        log.warning("Не получилось добавить музыку или видео: %s", p.stderr.decode(errors="replace")[-300:])
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
