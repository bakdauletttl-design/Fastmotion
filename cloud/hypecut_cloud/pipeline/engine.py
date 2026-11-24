"""Весь путь длинного видео: источник -> файл -> речь -> спикеры -> анализ -> моменты -> клипы в очереди.

Каждый шаг пишет статус и прогресс в sources, приложение показывает их на «Эфире».
Готовые клипы попадают в общую очередь (status=pending) рядом с клипами со стримов: принять, отклонить, в Studio.
"""
from __future__ import annotations

import json
import logging
import shutil
import time
from pathlib import Path
from typing import Callable

from .. import enhance
from ..db import DB
from ..plans import Plan, long_video_plan
from . import analysis, media
from .connectors import CONNECTORS, SourceError
from .scenarios import pick

log = logging.getLogger(__name__)

# доля всего пути, к которой приходим после шага (для полоски прогресса)
STEPS = [("ingest", 0.15), ("transcribe", 0.55), ("speakers", 0.65), ("analyze", 0.75), ("detect", 0.8), ("generate", 1.0)]


def diarize(path: Path) -> list[analysis.Turn] | None:
    """Кто когда говорит. Нужен pyannote.audio и HF_TOKEN; без них считаем, что спикер один."""
    import os
    if not os.environ.get("HF_TOKEN"):
        return None
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        return None
    try:
        pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=os.environ["HF_TOKEN"])
        names: dict[str, str] = {}
        turns = []
        for seg, _, who in pipe(str(path)).itertracks(yield_label=True):
            names.setdefault(who, f"Спикер {len(names) + 1}")
            turns.append((seg.start, seg.end, names[who]))
        return turns
    except Exception:
        log.exception("Не получилось разделить речь по спикерам")
        return None


class Engine:
    def __init__(self, db: DB, clips_dir: Path, upload_path: Callable[[int, str], Path],
                 transcribe: Callable[[Path], list] | None = None, diarizer: Callable[[Path], list | None] | None = None,
                 review: Callable = analysis.ai_review, on_clip: Callable[[str, int], None] | None = None):
        self.db, self.clips_dir, self.upload_path = db, clips_dir, upload_path
        self.transcribe = transcribe or enhance.transcribe
        self.diarize = diarizer or diarize
        self.review = review
        self.on_clip = on_clip or (lambda clip_id, uid: None)

    def _step(self, sid: str, name: str, done: float | None = None) -> None:
        before = dict(STEPS)
        idx = [n for n, _ in STEPS].index(name)
        start = STEPS[idx - 1][1] if idx else 0.0
        self.db.set_source(sid, status=name, progress=round(start if done is None else start + (before[name] - start) * done, 3))

    def run(self, sid: str) -> None:
        src = self.db.source(sid)
        if src is None:
            return
        user = self.db.user(src["user_id"])
        plan = long_video_plan(self.db.plan_of(user))
        work = self.clips_dir / "sources" / sid
        work.mkdir(parents=True, exist_ok=True)
        try:
            self._run(src, user, plan, work)
        except SourceError as e:
            self.db.set_source(sid, status="failed", error=str(e), finished=time.time())
        except Exception:
            log.exception("Видео %s не обработано", sid)
            self.db.set_source(sid, status="failed", error="Не получилось обработать видео, попробуй ещё раз", finished=time.time())

    def _run(self, src, user, plan: Plan, work: Path) -> None:
        sid, uid = src["id"], src["user_id"]
        sc = pick(src["scenario"], src["kind"])
        # 1. Source Connector: достать видео
        self._step(sid, "ingest")
        integ = self.db.integrations(uid).get(src["platform"] or "")
        ctx = {"platform": src["platform"], "token": integ["access_token"] if integ else None,
               "upload_path": lambda upid: self.upload_path(uid, upid)}
        got = CONNECTORS[src["kind"]].fetch(src["ref"], work, ctx)
        # 2. Media Processing: длина, качество, громкость
        duration, height = media.probe(got.path)
        if duration <= 0:
            raise SourceError("Не получилось прочитать видео")
        left = self.db.hours_left(uid, plan)
        if left is not None and duration / 3600 > left + 0.05:
            raise SourceError(f"Видео длиннее, чем осталось часов обработки ({left:.1f} ч). Докупи часы в «Тарифах»")
        title = src["title"] or got.title or "Видео"
        thumb = media.thumbnail(got.path, min(30.0, duration / 3), work / "thumb.jpg")
        self.db.set_source(sid, duration=round(duration, 1), title=title, file=str(got.path),
                           thumb=str(thumb) if thumb else None)
        levels = media.loudness(got.path)
        # 3. AI Analysis: речь со словами и таймингом
        self._step(sid, "transcribe")
        words = [(w[0], w[1], w[2]) for w in self.transcribe(got.path)]
        # 4. кто говорит
        self._step(sid, "speakers")
        turns = self.diarize(got.path) if sc.speakers else None
        speakers = sorted({t[2] for t in turns}) if turns else []
        self.db.set_source(sid, speakers=json.dumps(speakers, ensure_ascii=False))
        sents = analysis.sentences(words, turns)
        self.db.add_segments(sid, [(s.start, s.end, s.speaker, s.text, json.dumps(s.words, ensure_ascii=False)) for s in sents])
        # 5. Highlight Detection: моменты, границы, оценка
        self._step(sid, "analyze")
        hs = analysis.find_highlights(words, sc, turns, levels, duration=duration)
        left_clips = None if plan.ai_clips is None else max(0, plan.ai_clips - self.db.hours(uid)["ai_clips_used"])
        if left_clips is not None:
            hs = hs[:left_clips]
        self._step(sid, "detect")
        hs = self.review(hs, sc, title)
        # 6. Clip Generation: файлы клипов, вертикаль и субтитры делаются при первом просмотре (variants.py)
        made = 0
        for i, h in enumerate(hs):
            self._step(sid, "generate", i / max(1, len(hs)))
            clip_id = f"{sid}_{i + 1}"
            out = media.cut(got.path, h.start, h.end, self.clips_dir / f"{clip_id}.mp4", max_height=plan.height if plan.height > 720 else 1080)
            if out is None:
                continue
            th = media.thumbnail(out, min(2.0, (h.end - h.start) / 2), out.with_suffix(".jpg"))
            rel = [[round(a - h.start, 2), round(b - h.start, 2), t] for a, b, t in h.words if h.start <= a < h.end]
            hid = f"h_{clip_id}"
            self.db.add_highlight(id=hid, source_id=sid, start=h.start, end=h.end, score=h.score, scenario=sc.id,
                                  reason=h.reason, title=h.title, quote=h.quote, speaker=h.speaker, emotion=h.emotion,
                                  signals=json.dumps(h.signals), clip_id=clip_id)
            self.db.add_clip(id=clip_id, channel=f"src:{sid}", stream_id=sid, file=out.name, thumb=th.name if th else None,
                             reason=h.reason, kind="ai", created=time.time(), duration=round(h.end - h.start, 1),
                             moment=None, messages="[]", title=h.title, transcript=" ".join(w[2] for w in h.words) or None,
                             words=json.dumps(rel, ensure_ascii=False), height=min(height or 1080, plan.height),
                             source_id=sid, highlight_id=hid, scenario=sc.id, score=h.score, status="pending",
                             speaker=h.speaker, quote=h.quote, emotion=h.emotion, signals=json.dumps(h.signals, ensure_ascii=False),
                             stream_at=h.start)
            self.db.add_delivery(clip_id, uid, sid, sent=False)
            self.on_clip(clip_id, uid)
            made += 1
        self.db.spend_hours(uid, plan, duration / 3600, made)
        self.db.set_source(sid, status="done", progress=1.0, clips=made, finished=time.time())
        # длинный исходник больше не нужен, клипы уже вырезаны (загрузку человека тоже не держим)
        if got.path.is_relative_to(work) or src["kind"] == "upload":
            got.path.unlink(missing_ok=True)
        shutil.rmtree(work / "tmp", ignore_errors=True)
