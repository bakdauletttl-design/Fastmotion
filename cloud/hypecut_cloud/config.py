"""Настройки сервера из переменных окружения (файл .env рядом с docker-compose.yml)."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


def _list(name: str) -> list[str]:
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]


@dataclass
class Config:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("HYPECUT_DATA", "data")))
    bot_token: str = field(default_factory=lambda: os.environ.get("TELEGRAM_BOT_TOKEN", ""))
    bot_username: str = field(default_factory=lambda: os.environ.get("TELEGRAM_BOT_USERNAME", "").lstrip("@"))
    jwt_secret: str = field(default_factory=lambda: os.environ.get("JWT_SECRET") or secrets.token_hex(32))
    google_client_ids: list[str] = field(default_factory=lambda: _list("GOOGLE_CLIENT_IDS"))
    apple_bundle_ids: list[str] = field(default_factory=lambda: _list("APPLE_BUNDLE_IDS"))
    revenuecat_secret: str = field(default_factory=lambda: os.environ.get("REVENUECAT_WEBHOOK_SECRET", ""))
    admin_token: str = field(default_factory=lambda: os.environ.get("ADMIN_TOKEN", ""))
    public_url: str = field(default_factory=lambda: os.environ.get("PUBLIC_URL", "http://localhost:8080").rstrip("/"))
    app_url: str = field(default_factory=lambda: os.environ.get("APP_URL", ""))
    dev_login: bool = field(default_factory=lambda: os.environ.get("DEV_LOGIN") == "1")
    max_streams: int = field(default_factory=lambda: int(os.environ.get("MAX_STREAMS", "20")))
    quality: str = field(default_factory=lambda: os.environ.get("STREAM_QUALITY", "720p60"))
    # параметры нарезки, как в настольной версии
    segment_seconds: int = 4
    buffer_seconds: int = 180
    pre_roll: float = 20.0
    post_roll: float = 10.0
    cooldown: float = 45.0
    chat_window: int = 10
    chat_multiplier: float = 3.0
    chat_min_messages: int = 15
    audio_db_above: float = 8.0
    hype_words: list[str] = field(default_factory=lambda: [
        "kekw", "pog", "poggers", "pogchamp", "lul", "omegalul", "clip", "клип", "wtf",
        "ахах", "хаха", "лол", "жесть", "имба", "!!!", "monkas", "pepega"])
    clip_keep_days: int = 3  # сколько дней хранить файлы клипов на сервере

    @property
    def db_path(self) -> Path:
        return self.data_dir / "hypecut.db"

    @property
    def clips_dir(self) -> Path:
        return self.data_dir / "clips"

    @property
    def buffers_dir(self) -> Path:
        return self.data_dir / "buffers"
