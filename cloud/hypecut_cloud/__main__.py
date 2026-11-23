"""Запуск всего сервиса одной командой: python -m hypecut_cloud"""
from __future__ import annotations

import asyncio
import logging
import os

import uvicorn

from .api import create_app
from .bot import Bot
from .config import Config
from .db import DB
from .telegram_api import TelegramAPI
from .worker import Dispatcher, Manager

log = logging.getLogger("hypecut_cloud")


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Config()
    if not os.environ.get("JWT_SECRET"):
        log.warning("JWT_SECRET не задан: после перезапуска всем придётся войти заново")
    cfg.clips_dir.mkdir(parents=True, exist_ok=True)
    db = DB(cfg.db_path)
    api = TelegramAPI(cfg.bot_token) if cfg.bot_token else None
    dispatcher = Dispatcher(cfg, db, api)
    manager = Manager(cfg, db, dispatcher)
    app = create_app(cfg, db, on_change=manager.poke, status=manager.status)
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
                                           log_level="info"))
    tasks = [asyncio.create_task(server.serve()), asyncio.create_task(manager.run())]
    if api:
        bot = Bot(cfg, db, api)
        bot.on_change = manager.poke
        tasks.append(asyncio.create_task(bot.run()))
        log.info("Бот @%s запущен", cfg.bot_username or "?")
    else:
        log.warning("TELEGRAM_BOT_TOKEN не задан: бот не запущен")
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
    await asyncio.gather(*pending, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
