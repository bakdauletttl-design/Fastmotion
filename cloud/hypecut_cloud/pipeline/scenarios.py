"""Сценарии анализа: что считать интересным в видео разного типа.

Сценарий не меняет код движка, только веса сигналов, длину клипов и подсказку для нейросети.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# сигналы, которые находит analysis.py; у каждого слова для поиска в речи (ru + en)
CUES: dict[str, re.Pattern] = {
    "quote": re.compile(r"\b(главное|важно|никогда|всегда|секрет|правило|запомни|суть|ключ|на самом деле|"
                        r"the key|never|always|secret|the truth|remember|most important)\b", re.I),
    "insight": re.compile(r"\b(потому что|поэтому|значит|вывод|идея|пример|представьте|because|so the|which means|"
                          r"for example|imagine|the idea)\b", re.I),
    "laughter": re.compile(r"(ха-?ха|ахах|хах|\(смех\)|\[смех\]|lol|haha|\(laughs?\)|\[laughter\])", re.I),
    "emotion": re.compile(r"(!{1,}|\b(вау|офигеть|невероятно|жесть|блин|wow|insane|crazy|oh my god|no way)\b)", re.I),
    "question": re.compile(r"\?"),
    "decision": re.compile(r"\b(решили|договорились|фиксируем|итак|итог|задача|дедлайн|запускаем|"
                           r"we decided|let's go with|action item|deadline|next steps|to summarize)\b", re.I),
    "applause": re.compile(r"(\(аплодисменты\)|\[аплодисменты\]|\(applause\)|\[applause\]|спасибо[, ]+\w+!)", re.I),
    "announce": re.compile(r"\b(анонс|объявляем|представляем|впервые|новый|запуск|announce|introducing|launch|for the first time)\b", re.I),
}

SIGNAL_TITLES = {
    "quote": "цитата", "insight": "ключевая мысль", "laughter": "смех", "emotion": "эмоция", "question": "вопрос",
    "decision": "решение", "applause": "аплодисменты", "announce": "анонс", "loud": "громкость",
    "speaker_change": "смена спикера", "chat": "чат",
}


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    weights: dict[str, float]
    min_len: float = 15.0    # секунд
    max_len: float = 60.0
    max_clips: int = 8
    hint: str = ""           # для нейросети: что искать
    speakers: bool = True    # искать смену спикеров
    extra: dict = field(default_factory=dict)


S = Scenario
SCENARIOS: dict[str, Scenario] = {
    "stream": S("stream", "Стрим / игра", {"emotion": 3, "laughter": 3, "loud": 3, "chat": 3, "quote": 1, "announce": 1},
                min_len=12, max_len=45, hint="эмоции, реакции, крики, смешные и игровые моменты", speakers=False),
    "podcast": S("podcast", "Подкаст", {"quote": 3, "insight": 2.5, "laughter": 2, "speaker_change": 1.5, "emotion": 1.5, "question": 1},
                 hint="сильные цитаты, шутки, споры, смену собеседника"),
    "interview": S("interview", "Интервью", {"quote": 3, "insight": 2, "question": 2, "speaker_change": 2, "emotion": 1.5, "laughter": 1},
                   hint="яркие ответы гостя и неожиданные признания"),
    "lecture": S("lecture", "Лекция / урок", {"insight": 3, "quote": 2.5, "question": 2, "announce": 1},
                 min_len=20, max_len=75, hint="ключевые мысли, понятные примеры, вопросы из зала", speakers=False),
    "webinar": S("webinar", "Вебинар", {"insight": 3, "quote": 2, "question": 2.5, "decision": 1},
                 min_len=20, max_len=75, hint="главные советы и ответы на вопросы"),
    "meeting": S("meeting", "Встреча", {"decision": 3.5, "question": 2, "insight": 1.5, "speaker_change": 1},
                 min_len=15, max_len=60, max_clips=6, hint="решения, важные вопросы, итоги"),
    "event": S("event", "Конференция", {"quote": 3, "applause": 3, "announce": 2.5, "loud": 1.5, "insight": 1.5},
               min_len=15, max_len=60, hint="цитаты спикеров, аплодисменты, анонсы"),
}


def pick(scenario: str | None, kind: str) -> Scenario:
    """«Авто»: для встречи — встреча, для мероприятия — конференция, иначе подкаст (речь важнее всего)."""
    if scenario in SCENARIOS:
        return SCENARIOS[scenario]
    return SCENARIOS["meeting" if kind == "meeting" else "event" if kind == "event" else "podcast"]
