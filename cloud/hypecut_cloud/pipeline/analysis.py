"""AI Analysis и Highlight Detection: из распознанной речи находит лучшие моменты.

Работает без сети: речь (слова с таймингом), кто говорит, громкость по секундам и (для стримов) активность чата.
Нейросеть (ai_review) по желанию уточняет оценку и пишет заголовки, но без неё моменты тоже находятся.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import statistics
from dataclasses import dataclass, field

from .scenarios import CUES, SIGNAL_TITLES, Scenario

log = logging.getLogger(__name__)

Word = tuple[float, float, str]          # (начало, конец, слово)
Turn = tuple[float, float, str]          # (начало, конец, кто говорит)

EMOTION_OF = {"laughter": "смех", "applause": "восторг", "emotion": "удивление", "decision": "уверенность",
              "question": "интерес", "announce": "воодушевление", "loud": "восторг"}


@dataclass
class Sentence:
    start: float
    end: float
    text: str
    speaker: str | None = None
    words: list[Word] = field(default_factory=list)
    signals: dict[str, int] = field(default_factory=dict)


@dataclass
class Highlight:
    start: float
    end: float
    score: int                       # 0..100
    signals: list[str]
    quote: str | None
    speaker: str | None
    emotion: str | None
    title: str
    words: list[Word] = field(default_factory=list)

    @property
    def reason(self) -> str:
        return " · ".join(SIGNAL_TITLES.get(s, s) for s in self.signals[:3])


def speaker_at(turns: list[Turn] | None, t: float) -> str | None:
    if not turns:
        return None
    for a, b, who in turns:
        if a <= t < b:
            return who
    return min(turns, key=lambda x: min(abs(x[0] - t), abs(x[1] - t)))[2]


def sentences(words: list[Word], turns: list[Turn] | None = None, pause: float = 0.8, max_len: float = 20.0) -> list[Sentence]:
    """Слова -> фразы: конец фразы по точке/вопросу/восклицанию, длинной паузе или смене говорящего."""
    out: list[Sentence] = []
    cur: list[Word] = []
    who = None

    def flush():
        if cur:
            out.append(Sentence(cur[0][0], cur[-1][1], " ".join(w[2] for w in cur).strip(), who, list(cur)))
            cur.clear()

    for i, w in enumerate(words):
        sp = speaker_at(turns, (w[0] + w[1]) / 2)
        if cur and (sp != who or w[0] - cur[-1][1] > pause or w[1] - cur[0][0] > max_len):
            flush()
        if not cur:
            who = sp
        cur.append(w)
        if re.search(r"[.!?…]$", w[2]):
            flush()
    flush()
    for i, s in enumerate(out):
        s.signals = {k: len(rx.findall(s.text)) for k, rx in CUES.items() if rx.search(s.text)}
        if i and s.speaker and out[i - 1].speaker and s.speaker != out[i - 1].speaker:
            s.signals["speaker_change"] = 1
    return out


def loud_seconds(levels: list[float] | None, above: float = 8.0) -> set[int]:
    """Секунды, где громкость заметно выше обычной (крик, смех зала, аплодисменты)."""
    if not levels or len(levels) < 10:
        return set()
    base = statistics.median(levels)
    return {i for i, v in enumerate(levels) if v - base >= above}


def _raw(sents: list[Sentence], sc: Scenario, loud: set[int], chat: dict[int, float] | None) -> tuple[float, dict[str, float]]:
    got: dict[str, float] = {}
    for s in sents:
        for k, n in s.signals.items():
            if k in sc.weights:
                got[k] = got.get(k, 0) + sc.weights[k] * min(n, 2)
    a, b = int(sents[0].start), int(sents[-1].end) + 1
    if "loud" in sc.weights and loud:
        n = sum(1 for t in range(a, b) if t in loud)
        if n:
            got["loud"] = sc.weights["loud"] * min(n / 3, 2)
    if "chat" in sc.weights and chat:
        peak = max((chat.get(t, 0) for t in range(a, b)), default=0)
        if peak >= 2:
            got["chat"] = sc.weights["chat"] * min(peak / 2, 2)
    # длинная мысль без пауз тоже ценна: немного за плотность речи
    words = sum(len(s.words) for s in sents)
    dur = max(1.0, sents[-1].end - sents[0].start)
    total = sum(got.values()) + min(words / dur, 3.5) * 0.3
    return total, got


def to_score(raw: float) -> int:
    """Сырые очки -> оценка из 100, плавно: первые сигналы дают много, следующие всё меньше."""
    return max(1, min(99, round(35 + 64 * (1 - math.exp(-raw / 9)))))


def find_highlights(words: list[Word], sc: Scenario, turns: list[Turn] | None = None, levels: list[float] | None = None,
                    chat: dict[int, float] | None = None, duration: float | None = None, min_score: int = 55) -> list[Highlight]:
    """Лучшие моменты без пересечений: каждая фраза с сигналом — кандидат, окно растёт по фразам до нужной длины."""
    sents = sentences(words, turns if sc.speakers else None)
    if not sents:
        return []
    loud = loud_seconds(levels)
    end_of_video = duration or sents[-1].end
    cands: list[tuple[float, int, int, dict[str, float]]] = []
    for i, s in enumerate(sents):
        if not any(k in sc.weights for k in s.signals) and not (loud and any(int(s.start) <= t <= int(s.end) for t in loud)):
            continue
        a = b = i
        # сначала добираем контекст до момента (одна-две фразы), потом после
        while a > 0 and s.start - sents[a - 1].start <= sc.min_len * 0.4 and sents[b].end - sents[a - 1].start <= sc.max_len:
            a -= 1
        while sents[b].end - sents[a].start < sc.min_len and b + 1 < len(sents) and sents[b + 1].end - sents[a].start <= sc.max_len:
            b += 1
        while sents[b].end - sents[a].start < sc.min_len and a > 0 and sents[b].end - sents[a - 1].start <= sc.max_len:
            a -= 1
        raw, got = _raw(sents[a:b + 1], sc, loud, chat)
        cands.append((raw, a, b, got))
    cands.sort(key=lambda c: -c[0])
    taken: list[tuple[float, float]] = []
    out: list[Highlight] = []
    for raw, a, b, got in cands:
        start, end = max(0.0, sents[a].start - 0.3), min(end_of_video, sents[b].end + 0.4)
        if any(start < y and end > x for x, y in taken):
            continue
        score = to_score(raw)
        if score < min_score:
            continue
        part = sents[a:b + 1]
        signals = [k for k, _ in sorted(got.items(), key=lambda kv: -kv[1])]
        best = max(part, key=lambda s: sum(sc.weights.get(k, 0) * n for k, n in s.signals.items()) + len(s.text) / 400)
        quote = best.text.strip()
        if len(quote) > 140:
            quote = quote[:137].rsplit(" ", 1)[0] + "…"
        emotion = next((EMOTION_OF[k] for k in signals if k in EMOTION_OF), "спокойствие")
        title = _simple_title(quote, signals)
        out.append(Highlight(round(start, 2), round(end, 2), score, signals, quote, best.speaker, emotion, title,
                             [w for s in part for w in s.words]))
        taken.append((start, end))
        if len(out) >= sc.max_clips:
            break
    return sorted(out, key=lambda h: -h.score)


def _simple_title(quote: str, signals: list[str]) -> str:
    q = re.sub(r"\s+", " ", quote).strip(" .,…")
    if len(q) <= 60:
        return f"«{q}»" if "quote" in signals else q[:1].upper() + q[1:]
    return q[:57].rsplit(" ", 1)[0] + "…"


def ai_review(highlights: list[Highlight], sc: Scenario, title: str, lang_hint: str = "") -> list[Highlight]:
    """Нейросеть уточняет оценку каждого момента и пишет заголовок. Только если задан ANTHROPIC_API_KEY."""
    if not highlights or not os.environ.get("ANTHROPIC_API_KEY"):
        return highlights
    try:
        import anthropic
    except ImportError:
        return highlights
    items = [{"n": i, "text": " ".join(w[2] for w in h.words)[:1200], "signals": h.signals} for i, h in enumerate(highlights)]
    prompt = (
        f"Ты отбираешь моменты из длинного видео для коротких вертикальных клипов (TikTok, Reels, Shorts).\n"
        f"Видео: {title}\nТип видео: {sc.title}. Ищем: {sc.hint}.\n"
        "Для каждого фрагмента оцени от 0 до 100, насколько он зацепит зрителя без контекста, и напиши заголовок до 60 символов "
        "на языке фрагмента. Не выдумывай того, чего нет в тексте. Ответь только JSON-списком вида "
        '[{"n": 0, "score": 80, "title": "..."}].\n\n' + json.dumps(items, ensure_ascii=False))
    try:
        client = anthropic.Anthropic(timeout=40, max_retries=1)
        resp = client.beta.messages.create(
            model=os.environ.get("HYPECUT_TITLE_MODEL", "claude-opus-5-5"),
            max_tokens=2000,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text")
        data = json.loads(text[text.index("["): text.rindex("]") + 1])
    except Exception as e:  # сеть, лимиты, кривой JSON: остаёмся при своей оценке
        log.warning("AI-оценка моментов не сработала: %s", e)
        return highlights
    for x in data:
        try:
            h = highlights[int(x["n"])]
        except (KeyError, ValueError, IndexError, TypeError):
            continue
        if isinstance(x.get("score"), (int, float)):
            h.score = max(1, min(99, round((h.score + float(x["score"])) / 2)))
        if isinstance(x.get("title"), str) and x["title"].strip():
            h.title = x["title"].strip().strip('"«»')[:80]
    return sorted(highlights, key=lambda h: -h.score)
