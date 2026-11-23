# Fastmotion

Следит за Twitch-стримом в реальном времени, сам находит яркие моменты и режет клипы.
Клипы приходят в Telegram и лежат в веб-интерфейсе.

## Как это работает

```
twitch.tv ──streamlink──► ffmpeg ──► буфер: последние 3 мин кусками по 4 с
                                         │
чат (IRC, без логина) ──► детектор чата ─┤  всплеск сообщений / KEKW, POG, «клип»
громкость кусков ───────► детектор звука ┘  крик, взрыв, резкий звук
                                         ▼
                         клип: 20 с до момента + 10 с после (без перекодирования)
                                         ▼
                         Telegram-бот  +  веб-интерфейс http://localhost:8000
```

## Запуск

Нужны Python 3.10+ и ffmpeg (`winget install ffmpeg` / `brew install ffmpeg` / `apt install ffmpeg`).

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # и впишите TWITCH_CHANNEL
python -m fastmotion
```

Откройте http://localhost:8000. Кнопка «✂️ Клип сейчас» режет момент вручную.

## Telegram

1. Напишите @BotFather → `/newbot`, получите токен → `TELEGRAM_BOT_TOKEN`.
2. Напишите своему боту любое сообщение, затем узнайте свой id у @userinfobot → `TELEGRAM_CHAT_ID`.
   Можно указать id группы или канала, куда добавлен бот.

## Настройка чувствительности

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `CHAT_MULTIPLIER` | 3.0 | во сколько раз чат должен быть активнее обычного |
| `CHAT_MIN_MESSAGES` | 15 | минимум сообщений за 10 с (для маленьких каналов уменьшить) |
| `HYPE_WORDS` | kekw,pog,lul,клип… | слова, которые весят вдвое больше |
| `AUDIO_DB_ABOVE` | 8 | насколько dB громче обычного для срабатывания |
| `CLIP_PRE_ROLL` / `CLIP_POST_ROLL` | 20 / 10 | секунд до и после момента |
| `CLIP_COOLDOWN` | 45 | пауза между клипами |

## Тесты

```bash
pip install pytest && python -m pytest -q
```
