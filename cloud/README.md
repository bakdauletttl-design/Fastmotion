# HypeCut Cloud

Сервер HypeCut для многих пользователей. Он сам смотрит стримы на Twitch, YouTube, Kick, VK Видео и TikTok, режет яркие моменты
и рассылает клипы через **одного общего бота** HypeCut в Telegram. Мобильное приложение
(папка `mobile/`) нужно для входа, выбора каналов, просмотра клипов и оплаты.

```
Приложение (Apple / Google вход) ──► сервер: аккаунт + 3 дня бесплатно
        │  «Подключить Telegram»
        ▼
t.me/HypeCutBot?start=<одноразовый код> ──► бот связывает Telegram с аккаунтом
        │
пользователь выбирает каналы (в приложении или прямо в боте)
        ▼
сервер: на каждый канал один воркер (запись + чат + звук), даже если подписчиков 1000
        ▼
клип режется один раз ──► Telegram: загружается один раз, остальным уходит по file_id
                      └──► вертикальная 9:16 версия для тарифов Standard и Pro
```

## Что внутри

| Файл | Что делает |
| --- | --- |
| `hypecut_cloud/api.py` | API для приложения: вход, профиль, каналы, клипы, оплата, удаление аккаунта |
| `hypecut_cloud/bot.py` | Общий бот: `/start <код>`, ник или ссылка на канал, `/list`, `/remove`, `/plan` |
| `hypecut_cloud/worker.py` | Запись стримов и нарезка (использует код из `hypecut/`), рассылка по тарифам |
| `hypecut_cloud/sources.py` | Площадки: понимает ссылки Twitch, YouTube, Kick, VK Видео, TikTok |
| `hypecut_cloud/plans.py` | Тарифы: пробный 3 дня, Standard $10, Pro $20, Max $50 |
| `hypecut_cloud/db.py` | База SQLite: пользователи, каналы, клипы, кому что отправлено |

Тарифы:

| | Пробный | Standard | Pro | Max |
| --- | --- | --- | --- | --- |
| Цена | 3 дня бесплатно | $10 / мес | $20 / мес | $50 / мес |
| Звёзды Telegram | | 650 ⭐ | 1300 ⭐ | 3250 ⭐ |
| Качество | 720p | 720p | 1080p | до 2K (1440p) |
| Каналов | 1 | 3 | 5 | 10 |
| Клипов за стрим | 5 | 20 | 50 | 100 |
| Вертикальные 9:16 с субтитрами | нет | да | да | да |
| Авто-клип | 30 с | 30 с | 30 с | 45 с |
| Свой клип и монтаж до | 30 с | 1 мин | 1,5 мин | 2 мин |
| Очередь | обычная | обычная | первыми | первыми |

Качество не может быть выше, чем у самого стрима: если стример вещает в 1080p, Max получит 1080p.
Стрим записывается один раз в лучшем качестве, которое нужно подписчикам канала, а версии
для других тарифов делаются из него. Если 2K-клип не влезает в лимит Telegram (50 МБ),
в Telegram уходит 1080p, а 2K остаётся в приложении.

## Как запустить на сервере

Нужен любой VPS с Linux (например Hetzner CX22, около $5 в месяц, или 4 ядра за $15–20 для 20+ стримов),
домен, указывающий на сервер, и Docker.

1. Создайте бота в [@BotFather](https://t.me/BotFather): `/newbot`, имя **HypeCut**, ник `HypeCut_bot` (уже создан). Скопируйте токен.
2. На сервере:
   ```bash
   git clone https://github.com/bakdauletttl-design/fastmotion.git
   cd fastmotion/cloud
   cp .env.example .env
   nano .env      # вставьте токен бота, домен, JWT_SECRET и остальное
   docker compose up -d --build
   ```
3. Проверьте: `https://ваш-домен/health` должен ответить `{"ok": true}`.
4. Напишите боту в Telegram `/start` и пришлите ник любого стримера. Когда стример в эфире, клипы придут сами.

Бот работает даже без приложения: так можно проверить нарезку до публикации в магазинах.

## Площадки

| Площадка | Запись эфира | Как ищутся моменты |
| --- | --- | --- |
| Twitch | streamlink | всплески чата + громкий звук |
| YouTube Live | streamlink, запасной путь yt-dlp | громкий звук (чат YouTube добавим следующим) |
| Kick | streamlink, запасной путь yt-dlp | громкий звук |
| VK Видео Live | streamlink, запасной путь yt-dlp | громкий звук |
| TikTok Live | streamlink, запасной путь yt-dlp | громкий звук |

Канал хранится как `площадка:имя`, например `twitch:nightowl` или `youtube:@nightowl`.

## Качество клипов и дополнительные ключи

Все ключи ниже необязательны: без них сервис работает, просто без этой части.

| Что | Ключ в `.env` | Где взять |
| --- | --- | --- |
| Субтитры в вертикальных клипах | ничего, работает само (`WHISPER_MODEL=small`) | модель скачивается при сборке |
| Лицо стримера сверху в вертикали | ничего, работает само | |
| Заголовки клипов от ИИ | `ANTHROPIC_API_KEY` | platform.claude.com → API keys |
| Поиск стримеров, аватарки, сигнал «зрители делают клипы» | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | dev.twitch.tv → Console → Register Your Application |
| Отчёты об ошибках сервера | `SENTRY_DSN` | sentry.io, бесплатный тариф |

Без ключа ИИ заголовок берётся из самой частой фразы в чате или из слов стримера.

Цифры для владельца (пользователи, оплаты, клипы, оценки 👍/👎) открываются в браузере:
`https://ваш-домен/admin/stats?token=<ADMIN_TOKEN>`.

## Длинные видео: файл, ссылка, встречи, мероприятия

Кроме живых эфиров, HypeCut режет любое длинное видео: загрузку с телефона, ссылку (YouTube, Vimeo, Rutube, VK,
Dropbox или прямой .mp4), запись встречи из Zoom / Google Meet / Microsoft Teams и запись конференции.
Код лежит в `hypecut_cloud/pipeline/`: адаптер на каждый источник (`connectors.py`), дальше общий путь:
речь → спикеры → цитаты, эмоции, мысли → границы и оценка → клипы в общей очереди. Живые стримы идут старым путём.

Необязательные ключи в `.env`:

| Переменная | Зачем |
| --- | --- |
| `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | кнопка «Подключить Zoom» (приложение в marketplace.zoom.us) |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google Meet: записи из Google Диска |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Microsoft Teams: записи из OneDrive |
| `HF_TOKEN` | разделение речи по спикерам (нужен пакет pyannote.audio) |
| `ALLOWED_URL_HOSTS` | с каких сайтов можно присылать ссылки |
| `MAX_JOBS` | сколько длинных видео обрабатывать одновременно (по умолчанию 1) |
| `HYPECUT_PRICING` | путь к своему файлу тарифов вместо `hypecut_cloud/pricing.json` |

Адрес для входа в Zoom / Google / Microsoft: `https://ваш-домен/integrations/<zoom|meet|teams>/callback`.

## Тарифы

Цены, часы обработки, AI-клипы и тексты возможностей лежат в `hypecut_cloud/pricing.json`. Поменял файл, перезапустил
сервер, и приложение показывает новые тарифы без обновления. Цены пока предварительные.

## Оплата

Подписки продаются в App Store и Google Play через [RevenueCat](https://www.revenuecat.com) (бесплатно до $2.5k дохода в месяц).
В RevenueCat создайте продукты `hypecut_standard_monthly`, `hypecut_pro_monthly` и `hypecut_max_monthly`, а в
Project settings → Integrations → Webhooks укажите `https://ваш-домен/billing/revenuecat`
и заголовок Authorization `Bearer <REVENUECAT_WEBHOOK_SECRET>`.

## Если стример просит убрать свой канал

```bash
curl -X POST https://ваш-домен/admin/block -H "X-Admin-Token: <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" -d '{"channel": "ник"}'
```
Канал сразу пропадает у всех и больше не нарезается.

## Для разработчиков

```bash
pip install -r cloud/requirements.txt pytest
cd cloud && python -m pytest -q tests
# локальный запуск без бота, с тестовым входом:
DEV_LOGIN=1 PYTHONPATH=..:. python -m hypecut_cloud
```
