"""Пути к ffmpeg и папке данных: работает и из исходников, и из собранного .exe."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)


def bundle_dir() -> Path:
    """Папка с файлами, упакованными внутрь .exe (PyInstaller распаковывает их сюда)."""
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))


def app_dir() -> Path:
    """Папка рядом с .exe (или текущая папка при запуске из исходников)."""
    return Path(sys.executable).resolve().parent if FROZEN else Path.cwd()


def default_data_dir() -> Path:
    return app_dir() / "HypeCutData" if FROZEN else Path("data")


def _find(name: str) -> str:
    env = os.environ.get(name.upper() + "_PATH")
    if env:
        return env
    exe = name + (".exe" if os.name == "nt" else "")
    for d in (bundle_dir(), bundle_dir() / "bin", app_dir()):
        if (d / exe).exists():
            return str(d / exe)
    return shutil.which(name) or name


FFMPEG = _find("ffmpeg")

# На Windows не показывать чёрное окно консоли для каждого вызова ffmpeg
NO_WINDOW: dict = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
