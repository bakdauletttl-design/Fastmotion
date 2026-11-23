"""Настройки из переменных окружения (или файла .env)."""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .paths import default_data_dir

# Поля, которые можно менять из веб-интерфейса (сохраняются в settings.json)
EDITABLE = {
    "channel": str, "quality": str, "telegram_token": str, "telegram_chat_id": str,
    "pre_roll": int, "post_roll": int, "cooldown": int,
    "chat_multiplier": float, "chat_min_messages": int, "hype_words": list,
    "audio_enabled": bool, "audio_db_above": float,
}


def _load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass
class Settings:
    channel: str = ""
    quality: str = "best"
    data_dir: Path = field(default_factory=default_data_dir)

    # Буфер: стрим режется на куски по segment_seconds, храним buffer_seconds последних секунд
    segment_seconds: int = 4
    buffer_seconds: int = 180

    # Длина клипа: сколько секунд до и после момента
    pre_roll: int = 20
    post_roll: int = 10
    cooldown: int = 45  # не делать новых клипов N секунд после предыдущего

    # Детектор чата
    chat_window: int = 10           # окно подсчёта сообщений, сек
    chat_multiplier: float = 3.0    # во сколько раз активность выше обычной
    chat_min_messages: int = 15     # минимум сообщений в окне
    hype_words: list[str] = field(default_factory=lambda: [
        "kekw", "lul", "lol", "pog", "pogchamp", "poggers", "omegalul",
        "clip", "клип", "ахах", "хаха", "жесть", "wtf", "monkas", "ez",
    ])

    # Детектор звука
    audio_enabled: bool = True
    audio_db_above: float = 8.0     # насколько dB громче обычного

    # Telegram
    telegram_token: str = ""
    telegram_chat_id: str = ""

    host: str = "127.0.0.1"
    port: int = 8000

    @property
    def buffer_dir(self) -> Path:
        return self.data_dir / "buffer"

    @property
    def clips_dir(self) -> Path:
        return self.data_dir / "clips"

    @classmethod
    def from_env(cls) -> "Settings":
        _load_dotenv()
        s = cls()
        s.channel = _clean_channel(_env("TWITCH_CHANNEL", ""))
        s.quality = _env("STREAM_QUALITY", s.quality)
        s.data_dir = Path(_env("DATA_DIR", str(s.data_dir)))
        s.segment_seconds = int(_env("SEGMENT_SECONDS", str(s.segment_seconds)))
        s.buffer_seconds = int(_env("BUFFER_SECONDS", str(s.buffer_seconds)))
        s.pre_roll = int(_env("CLIP_PRE_ROLL", str(s.pre_roll)))
        s.post_roll = int(_env("CLIP_POST_ROLL", str(s.post_roll)))
        s.cooldown = int(_env("CLIP_COOLDOWN", str(s.cooldown)))
        s.chat_window = int(_env("CHAT_WINDOW", str(s.chat_window)))
        s.chat_multiplier = float(_env("CHAT_MULTIPLIER", str(s.chat_multiplier)))
        s.chat_min_messages = int(_env("CHAT_MIN_MESSAGES", str(s.chat_min_messages)))
        words = _env("HYPE_WORDS", "")
        if words:
            s.hype_words = [w.strip().lower() for w in words.split(",") if w.strip()]
        s.audio_enabled = _env("AUDIO_ENABLED", "1") not in ("0", "false", "no")
        s.audio_db_above = float(_env("AUDIO_DB_ABOVE", str(s.audio_db_above)))
        s.telegram_token = _env("TELEGRAM_BOT_TOKEN", "")
        s.telegram_chat_id = _env("TELEGRAM_CHAT_ID", "")
        s.host = _env("HOST", s.host)
        s.port = int(_env("PORT", str(s.port)))
        s.load_saved()
        return s

    @property
    def settings_file(self) -> Path:
        return self.data_dir / "settings.json"

    def load_saved(self) -> None:
        if self.settings_file.exists():
            self.update(json.loads(self.settings_file.read_text("utf-8")))

    def update(self, values: dict) -> None:
        """Применяет значения из формы, приводя типы и отбрасывая лишние ключи."""
        for key, typ in EDITABLE.items():
            if key not in values or values[key] is None:
                continue
            v = values[key]
            if typ is bool:
                v = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "on", "yes")
            elif typ is list:
                v = v if isinstance(v, list) else [w.strip() for w in str(v).split(",")]
                v = [str(w).strip().lower() for w in v if str(w).strip()]
            else:
                v = typ(v)
            if key == "channel":
                v = _clean_channel(v)
            if isinstance(v, str):
                v = v.strip()
            setattr(self, key, v)

    def editable(self) -> dict:
        d = asdict(self)
        return {k: d[k] for k in EDITABLE}

    def save(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.settings_file.write_text(json.dumps(self.editable(), ensure_ascii=False, indent=1), "utf-8")


def _clean_channel(value: str) -> str:
    """Принимает и ник, и ссылку вида https://www.twitch.tv/nick."""
    v = value.strip().lower().rstrip("/")
    if "twitch.tv/" in v:
        v = v.split("twitch.tv/", 1)[1].split("/")[0].split("?")[0]
    return v.lstrip("#@")
