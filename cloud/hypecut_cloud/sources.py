"""Площадки стримов: Twitch, YouTube, Kick, VK Видео Live, TikTok Live.

Канал хранится одной строкой-ключом «площадка:имя», например «twitch:nightowl» или «youtube:@nightowl».
"""
from __future__ import annotations

import re
from dataclasses import dataclass

PLATFORMS: dict[str, dict] = {
    "twitch": {"title": "Twitch", "chat": True},
    "youtube": {"title": "YouTube", "chat": False},
    "kick": {"title": "Kick", "chat": False},
    "vk": {"title": "VK Видео", "chat": False},
    "tiktok": {"title": "TikTok", "chat": False},
}

# ссылки, которые люди обычно копируют из браузера или приложения
_LINKS: list[tuple[str, re.Pattern]] = [
    ("twitch", re.compile(r"(?:^|//|\.)twitch\.tv/([A-Za-z0-9_]{4,25})(?:[/?#]|$)")),
    ("youtube", re.compile(r"(?:^|//|\.)youtube\.com/(@[\w.\-]{3,30})(?:[/?#]|$)")),
    ("youtube", re.compile(r"(?:^|//|\.)youtube\.com/channel/(UC[\w\-]{22})(?:[/?#]|$)")),
    ("kick", re.compile(r"(?:^|//|\.)kick\.com/([A-Za-z0-9_\-]{3,25})(?:[/?#]|$)")),
    ("vk", re.compile(r"(?:^|//|\.)(?:live\.vkvideo\.ru|vkplay\.live)/([\w.\-]{2,40})(?:[/?#]|$)")),
    ("tiktok", re.compile(r"(?:^|//|\.)tiktok\.com/(@[\w.]{2,24})(?:[/?#]|$)")),
]

_NAME = {
    "twitch": re.compile(r"^[a-z0-9_]{4,25}$"),
    "youtube": re.compile(r"^(@[\w.\-]{3,30}|UC[\w\-]{22})$"),
    "kick": re.compile(r"^[a-z0-9_\-]{3,25}$"),
    "vk": re.compile(r"^[\w.\-]{2,40}$"),
    "tiktok": re.compile(r"^@[\w.]{2,24}$"),
}


@dataclass(frozen=True)
class Source:
    platform: str
    name: str

    @property
    def key(self) -> str:
        return f"{self.platform}:{self.name}"

    @property
    def title(self) -> str:
        return PLATFORMS[self.platform]["title"]

    @property
    def url(self) -> str:
        """Ссылка на эфир, которую понимают streamlink и yt-dlp."""
        n = self.name
        return {
            "twitch": f"https://www.twitch.tv/{n}",
            "youtube": f"https://www.youtube.com/{n}/live" if n.startswith("@") else f"https://www.youtube.com/channel/{n}/live",
            "kick": f"https://kick.com/{n}",
            "vk": f"https://live.vkvideo.ru/{n}",
            "tiktok": f"https://www.tiktok.com/{n}/live",
        }[self.platform]

    @property
    def has_chat(self) -> bool:
        return PLATFORMS[self.platform]["chat"]

    @property
    def safe(self) -> str:
        """Имя для файлов и папок."""
        return re.sub(r"[^\w\-]", "", f"{self.platform}_{self.name}")

    def public(self) -> dict:
        return {"key": self.key, "platform": self.platform, "platform_title": self.title,
                "name": self.name, "url": self.url.removesuffix("/live")}


def _clean(platform: str, name: str) -> str | None:
    if platform == "youtube" and name.lower().startswith("uc") and not name.startswith("@"):
        cleaned = name  # id канала чувствителен к регистру
    else:
        cleaned = name.lower()
    if platform in ("youtube", "tiktok") and not cleaned.startswith("@") and not cleaned.startswith("UC"):
        cleaned = "@" + cleaned
    if platform in ("twitch", "kick", "vk"):
        cleaned = cleaned.lstrip("@")
    return cleaned if _NAME[platform].match(cleaned) else None


def parse_source(text: str, platform: str | None = None) -> Source | None:
    """Ссылка или ник -> Source. Ник без ссылки: площадка из `platform`, иначе Twitch."""
    t = (text or "").strip()
    if not t:
        return None
    if ":" in t and t.split(":", 1)[0] in PLATFORMS:  # уже ключ «площадка:имя»
        p, n = t.split(":", 1)
        name = _clean(p, n)
        return Source(p, name) if name else None
    for p, rx in _LINKS:
        m = rx.search(t)
        if m:
            name = _clean(p, m.group(1))
            return Source(p, name) if name else None
    if "/" in t or "." in t and not t.startswith("@"):
        return None  # ссылка на что-то, что мы не поддерживаем
    p = platform if platform in PLATFORMS else "twitch"
    name = _clean(p, t)
    return Source(p, name) if name else None


def from_key(key: str) -> Source:
    p, n = key.split(":", 1)
    return Source(p, n)
