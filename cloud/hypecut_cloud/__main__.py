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
from .push import Push
from .pipeline.engine import Engine
from .pipeline.jobs import Jobs
from .twitch import Twitch
from .worker import Dispatcher, Manager

log = logging.getLogger("hypecut_cloud")


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if os.environ.get("SENTRY_DSN"):
        # отчёты об ошибках сервера в sentry.io (необязательно)
        import sentry_sdk
        sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], traces_sample_rate=0.05, send_default_pii=False)
    cfg = Config()
    if not os.environ.get("JWT_SECRET"):
        log.warning("JWT_SECRET не задан: после перезапуска всем придётся войти заново")
    cfg.clips_dir.mkdir(parents=True, exist_ok=True)
    db = DB(cfg.db_path)
    api = TelegramAPI(cfg.bot_token) if cfg.bot_token else None
    dispatcher = Dispatcher(cfg, db, api, Push(db))
    twitch = Twitch()
    if not twitch.enabled:
        log.info("TWITCH_CLIENT_ID не задан: без поиска стримеров, аватарок и сигнала от клипов зрителей")
    manager = Manager(cfg, db, dispatcher, twitch=twitch)
    # длинные видео (файл, ссылка, встречи): своя очередь, живые стримы она не трогает
    uploads = cfg.clips_dir / "uploads"
    engine = Engine(db, cfg.clips_dir, upload_path=lambda uid, upid: uploads / f"u{uid}_{upid}.mp4")
    jobs = Jobs(db, engine)
    app = create_app(cfg, db, on_change=manager.poke, status=manager.status, twitch=twitch,
                     live=manager.worker, telegram=api, on_source=jobs.poke)
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
                                           log_level="info"))
    tasks = [asyncio.create_task(server.serve()), asyncio.create_task(manager.run()), asyncio.create_task(jobs.run())]
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
