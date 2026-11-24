"""Source Connectors: у каждого источника свой адаптер. Адаптер только достаёт видео в файл,
дальше всё общее (engine.py). Новая площадка = новый класс здесь, движок не меняется.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from . import meetings

log = logging.getLogger(__name__)

MAX_BYTES = 8 * 1024 ** 3        # 8 ГБ на одно видео
MAX_SECONDS = 6 * 3600           # до 6 часов


class SourceError(Exception):
    """Ошибка, которую можно показать человеку как есть."""


@dataclass
class Fetched:
    path: Path
    title: str | None = None
    duration: float | None = None


class Connector:
    kind = ""

    def probe(self, ref: str, ctx: dict) -> dict:
        """Быстро узнать название и длину до скачивания (для проверки часов). Может вернуть {}."""
        return {}

    def fetch(self, ref: str, workdir: Path, ctx: dict) -> Fetched:
        raise NotImplementedError


class UploadConnector(Connector):
    """Файл, который человек загрузил с телефона (POST /uploads?kind=source)."""
    kind = "upload"

    def fetch(self, ref: str, workdir: Path, ctx: dict) -> Fetched:
        path = Path(ctx["upload_path"](ref))
        if not path.exists():
            raise SourceError("Файл не найден, загрузи его ещё раз")
        return Fetched(path)


def allowed_hosts() -> list[str]:
    return [h.strip().lower() for h in os.environ.get(
        "ALLOWED_URL_HOSTS", "youtube.com,youtu.be,vimeo.com,rutube.ru,vk.com,vkvideo.ru,dropbox.com,drive.google.com"
    ).split(",") if h.strip()]


def check_url(url: str) -> str:
    """Только http(s), только разрешённые сайты или прямая ссылка на видеофайл. Внутренние адреса нельзя."""
    u = urlparse(url.strip())
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host or "." not in host:
        raise SourceError("Это не похоже на ссылку на видео")
    if host in ("localhost",) or re.fullmatch(r"[\d.]+|\[?[0-9a-f:]+\]?", host) or host.endswith((".local", ".internal")):
        raise SourceError("Эту ссылку открыть нельзя")
    direct = re.search(r"\.(mp4|mov|m4v|webm|mkv)$", u.path, re.I)
    if not direct and not any(host == h or host.endswith("." + h) for h in allowed_hosts()):
        raise SourceError("С этого сайта пока нельзя. Можно YouTube, Vimeo, Rutube, VK или прямую ссылку на файл")
    return url.strip()


class UrlConnector(Connector):
    """Ссылка: свой YouTube, Vimeo, Rutube, VK, Dropbox или прямая ссылка на файл. Качает yt-dlp."""
    kind = "url"

    def _ytdlp(self) -> list[str]:
        return ["yt-dlp", "--no-playlist", "--no-warnings", "--max-filesize", str(MAX_BYTES),
                "--match-filter", f"duration <= {MAX_SECONDS} & !is_live"]

    def probe(self, ref: str, ctx: dict) -> dict:
        try:
            r = subprocess.run(self._ytdlp() + ["-J", "--skip-download", check_url(ref)], capture_output=True, text=True, timeout=60)
            d = json.loads(r.stdout or "{}")
            return {"title": d.get("title"), "duration": d.get("duration")}
        except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
            return {}

    def fetch(self, ref: str, workdir: Path, ctx: dict) -> Fetched:
        url = check_url(ref)
        out = workdir / "source.%(ext)s"
        r = subprocess.run(self._ytdlp() + ["-f", "bv*[height<=1440]+ba/b[height<=1440]/b", "--merge-output-format", "mp4",
                                            "-o", str(out), "--print", "after_move:filepath", "--print", "title", url],
                           capture_output=True, text=True, timeout=3 * 3600)
        lines = [x for x in r.stdout.splitlines() if x.strip()]
        path = next((Path(x) for x in reversed(lines) if Path(x).exists()), None)
        if r.returncode != 0 or path is None:
            log.warning("yt-dlp: %s", r.stderr[-400:])
            raise SourceError("Не получилось скачать видео по ссылке. Проверь, что оно открыто и не идёт в прямом эфире")
        return Fetched(path, title=lines[0] if len(lines) > 1 else None)


class MeetingConnector(Connector):
    """Запись встречи из Zoom, Google Meet (Google Диск) или Microsoft Teams (OneDrive)."""
    kind = "meeting"

    def fetch(self, ref: str, workdir: Path, ctx: dict) -> Fetched:
        service = meetings.SERVICES.get(ctx["platform"])
        token = ctx.get("token")
        if service is None or not token:
            raise SourceError("Сначала подключи сервис встреч")
        rec = next((r for r in meetings.recordings(service, token) if r["id"] == ref), None)
        if rec is None:
            raise SourceError("Запись не найдена. Возможно, её удалили")
        path = meetings.download(service, token, rec["url"], workdir / "source.mp4", MAX_BYTES)
        return Fetched(path, title=rec["title"], duration=rec["duration"] or None)


class EventConnector(UrlConnector):
    """Мероприятие: запись конференции по ссылке (позже — живая трансляция зала)."""
    kind = "event"

    def fetch(self, ref: str, workdir: Path, ctx: dict) -> Fetched:
        if ctx.get("upload_path") and re.fullmatch(r"source_[0-9a-f]{12}", ref or ""):
            return UploadConnector().fetch(ref, workdir, ctx)
        return super().fetch(ref, workdir, ctx)


# «live» здесь нет: живые эфиры записывает worker.py, как и раньше
CONNECTORS: dict[str, Connector] = {c.kind: c for c in (UploadConnector(), UrlConnector(), MeetingConnector(), EventConnector())}


def platform_of(kind: str, ref: str, platform: str | None = None) -> str:
    if kind == "meeting":
        return platform or "zoom"
    if kind == "upload" or re.fullmatch(r"source_[0-9a-f]{12}", ref or ""):
        return "file"
    host = (urlparse(ref).hostname or "").lower()
    return "youtube" if "youtu" in host else "vimeo" if "vimeo" in host else "link"
