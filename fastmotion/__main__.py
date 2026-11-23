import logging

import uvicorn

from .config import Settings
from .web import create_app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = Settings.from_env()
    app = create_app(settings)
    print(f"Fastmotion: канал {settings.channel or '(не задан)'}, интерфейс http://localhost:{settings.port}")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
