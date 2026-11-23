# HypeCut Cloud

Сервер HypeCut для многих пользователей. Он сам смотрит стримы на Twitch, YouTube, Kick, VK Видео и TikTok, режет яркие моменты
и рассылает клипы через **одного общего бота** HypeCut в Telegram. Мобильное приложение
(папка `mobile/`) нужно для входа, выбора каналов, просмотра клипов и оплаты.

```
Приложение (Apple / Google вход) ──► сервер: аккаунт + 7 дней бесплатно
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
| `hypecut_cloud/plans.py` | Тарифы: пробный 7 дней, Standard $9.99, Pro $19.99 |
| `hypecut_cloud/db.py` | База SQLite: пользователи, каналы, клипы, кому что отправлено |

Тарифы:

| | Пробный | Standard | Pro |
| --- | --- | --- | --- |
| Цена | 7 дней бесплатно | $9.99 / мес | $19.99 / мес |
| Каналов | 1 | 3 | 10 |
| Клипов за стрим | 5 | 20 | без лимита |
| Вертикальные 9:16 | нет | да | да |
| Очередь | обычная | обычная | первыми |

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

## Оплата

Подписки продаются в App Store и Google Play через [RevenueCat](https://www.revenuecat.com) (бесплатно до $2.5k дохода в месяц).
В RevenueCat создайте продукты `hypecut_standard_monthly` и `hypecut_pro_monthly`, а в
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
