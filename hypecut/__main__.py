"""Точка входа: python -m hypecut или HypeCut.exe."""
import logging
import socket
import sys
import threading
import webbrowser

import uvicorn

from .config import Settings
from .paths import FROZEN
from .web import create_app


def _free_port(preferred: int) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 20)]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return preferred


def selftest() -> int:
    """Проверка сборки: ffmpeg запускается, streamlink знает Twitch."""
    import subprocess
    from streamlink import Streamlink
    from .paths import FFMPEG, NO_WINDOW

    out = subprocess.run([FFMPEG, "-version"], capture_output=True, text=True, **NO_WINDOW).stdout
    print("ffmpeg:", out.splitlines()[0] if out else "НЕ НАЙДЕН")
    name, _cls, _url = Streamlink().resolve_url("https://twitch.tv/test")
    print("streamlink plugin:", name)
    return 0 if out and name == "twitch" else 1


def main() -> None:
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    settings = Settings.from_env()
    settings.port = _free_port(settings.port)
    app = create_app(settings)
    url = f"http://localhost:{settings.port}"
    print("=" * 50)
    print(f"  HypeCut запущен: {url}")
    print(f"  Клипы сохраняются в: {settings.clips_dir.resolve()}")
    print("  Не закрывайте это окно, пока идёт стрим.")
    print("=" * 50)
    if FROZEN or "--open" in sys.argv:
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
