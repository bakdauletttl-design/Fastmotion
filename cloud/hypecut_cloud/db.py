"""База данных (SQLite). Пользователи, привязка Telegram, каналы, клипы и доставка."""
from __future__ import annotations

import secrets
import sqlite3
import threading
import time
from pathlib import Path

from .plans import TRIAL_DAYS, Plan, effective_plan
from .sources import parse_source

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,          -- apple | google | telegram | dev
    provider_sub TEXT NOT NULL,      -- id пользователя у провайдера
    email TEXT,
    name TEXT,
    created REAL NOT NULL,
    trial_until REAL,
    plan TEXT,                       -- standard | pro (оплаченный)
    plan_until REAL,
    telegram_chat_id INTEGER UNIQUE,
    telegram_username TEXT,
    UNIQUE (provider, provider_sub)
);
CREATE TABLE IF NOT EXISTS link_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS follows (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,           -- ключ «площадка:имя», например twitch:nightowl
    created REAL NOT NULL,
    PRIMARY KEY (user_id, channel)
);
CREATE TABLE IF NOT EXISTS blocked_channels (
    channel TEXT PRIMARY KEY,        -- стример попросил не нарезать его канал
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    stream_id TEXT NOT NULL,         -- одна запись стрима
    file TEXT NOT NULL,
    vertical_file TEXT,
    thumb TEXT,
    reason TEXT,
    kind TEXT,
    created REAL NOT NULL,
    duration REAL,
    moment REAL,                     -- на какой секунде клипа сам момент
    messages TEXT,                   -- сообщения чата вокруг момента (JSON-список строк)
    tg_file_id TEXT,                 -- после первой отправки Telegram отдаёт id, дальше шлём по нему
    tg_vertical_file_id TEXT,
    title TEXT,                      -- заголовок клипа (ИИ или по словам из чата)
    transcript TEXT                  -- что говорил стример (распознанная речь)
);
CREATE TABLE IF NOT EXISTS deliveries (
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stream_id TEXT NOT NULL,
    created REAL NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (clip_id, user_id)
);
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    plan TEXT NOT NULL,
    stars INTEGER NOT NULL,
    charge_id TEXT,                  -- id платежа в Telegram, нужен для возврата
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,          -- Expo push token телефона
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS follows_channel ON follows(channel);
CREATE INDEX IF NOT EXISTS deliveries_user ON deliveries(user_id, created);
"""

def normalize_channel(text: str, platform: str | None = None) -> str | None:
    """Ссылка или ник -> ключ канала «площадка:имя». None, если это не похоже на канал."""
    src = parse_source(text, platform)
    return src.key if src else None


class DB:
    def __init__(self, path: Path | str):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.lock = threading.RLock()

    def _migrate(self) -> None:
        """Добавляет новые колонки в старую базу, чтобы обновление сервера не теряло данные."""
        have = {r[1] for r in self.conn.execute("PRAGMA table_info(clips)")}
        for col in ("title", "transcript"):
            if col not in have:
                self.conn.execute(f"ALTER TABLE clips ADD COLUMN {col} TEXT")

    def q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def one(self, sql: str, args: tuple = ()) -> sqlite3.Row | None:
        rows = self.q(sql, args)
        return rows[0] if rows else None

    def x(self, sql: str, args: tuple = ()) -> int:
        with self.lock:
            cur = self.conn.execute(sql, args)
            return cur.lastrowid

    # ---------- пользователи ----------
    def upsert_user(self, provider: str, sub: str, email: str | None = None,
                    name: str | None = None, now: float | None = None) -> sqlite3.Row:
        now = now or time.time()
        row = self.one("SELECT * FROM users WHERE provider=? AND provider_sub=?", (provider, sub))
        if row:
            if email and email != row["email"]:
                self.x("UPDATE users SET email=? WHERE id=?", (email, row["id"]))
            return self.user(row["id"])
        uid = self.x("INSERT INTO users (provider, provider_sub, email, name, created, trial_until) "
                     "VALUES (?,?,?,?,?,?)", (provider, sub, email, name, now, now + TRIAL_DAYS * 86400))
        return self.user(uid)

    def user(self, uid: int) -> sqlite3.Row | None:
        return self.one("SELECT * FROM users WHERE id=?", (uid,))

    def user_by_chat(self, chat_id: int) -> sqlite3.Row | None:
        return self.one("SELECT * FROM users WHERE telegram_chat_id=?", (chat_id,))

    def plan_of(self, user: sqlite3.Row, now: float | None = None) -> Plan | None:
        return effective_plan(user["plan"], user["plan_until"], user["trial_until"], now or time.time())

    def set_plan(self, uid: int, plan: str | None, until: float | None) -> None:
        self.x("UPDATE users SET plan=?, plan_until=? WHERE id=?", (plan, until, uid))

    def delete_user(self, uid: int) -> None:
        self.x("DELETE FROM users WHERE id=?", (uid,))

    # ---------- пуш-уведомления ----------
    def add_push_token(self, uid: int, token: str) -> None:
        self.x("INSERT OR REPLACE INTO push_tokens VALUES (?,?,?)", (token, uid, time.time()))

    def remove_push_token(self, token: str) -> None:
        self.x("DELETE FROM push_tokens WHERE token=?", (token,))

    def push_tokens(self, uids: list[int]) -> list[str]:
        if not uids:
            return []
        marks = ",".join("?" * len(uids))
        return [r["token"] for r in self.q(f"SELECT token FROM push_tokens WHERE user_id IN ({marks})", tuple(uids))]

    # ---------- привязка Telegram ----------
    def new_link_token(self, uid: int, ttl: float = 3600) -> str:
        token = secrets.token_urlsafe(24)  # до 64 символов, подходит для /start
        self.x("DELETE FROM link_tokens WHERE user_id=? OR expires<?", (uid, time.time()))
        self.x("INSERT INTO link_tokens VALUES (?,?,?)", (token, uid, time.time() + ttl))
        return token

    def use_link_token(self, token: str, chat_id: int, username: str | None) -> sqlite3.Row | None:
        """Привязывает чат к аккаунту из приложения. Если чат уже был у «телеграм-аккаунта»
        (человек сначала пользовался только ботом), его каналы переносятся в аккаунт приложения."""
        with self.lock:
            row = self.one("SELECT * FROM link_tokens WHERE token=?", (token,))
            if not row or row["expires"] < time.time():
                return None
            uid = row["user_id"]
            self.x("DELETE FROM link_tokens WHERE token=?", (token,))
            old = self.user_by_chat(chat_id)
            if old and old["id"] != uid:
                self.x("UPDATE users SET telegram_chat_id=NULL WHERE id=?", (old["id"],))
                if old["provider"] == "telegram":
                    self.x("INSERT OR IGNORE INTO follows SELECT ?, channel, created FROM follows "
                           "WHERE user_id=?", (uid, old["id"]))
                    self.delete_user(old["id"])
            self.x("UPDATE users SET telegram_chat_id=NULL WHERE id=?", (uid,))
            self.x("UPDATE users SET telegram_chat_id=?, telegram_username=? WHERE id=?",
                   (chat_id, username, uid))
            return self.user(uid)

    # ---------- каналы ----------
    def follows(self, uid: int) -> list[str]:
        return [r["channel"] for r in self.q("SELECT channel FROM follows WHERE user_id=? ORDER BY created", (uid,))]

    def follow(self, uid: int, channel: str) -> str:
        """ok | exists | limit | blocked | no_plan"""
        user = self.user(uid)
        plan = self.plan_of(user)
        if plan is None:
            return "no_plan"
        if self.is_blocked(channel):
            return "blocked"
        current = self.follows(uid)
        if channel in current:
            return "exists"
        if len(current) >= plan.channels:
            return "limit"
        self.x("INSERT INTO follows VALUES (?,?,?)", (uid, channel, time.time()))
        return "ok"

    def unfollow(self, uid: int, channel: str) -> bool:
        before = len(self.follows(uid))
        self.x("DELETE FROM follows WHERE user_id=? AND channel=?", (uid, channel))
        return len(self.follows(uid)) < before

    def followers(self, channel: str) -> list[sqlite3.Row]:
        return self.q("SELECT u.* FROM users u JOIN follows f ON f.user_id=u.id WHERE f.channel=?", (channel,))

    def wanted_channels(self, now: float | None = None) -> list[tuple[str, bool]]:
        """Каналы, которые нужно записывать: (канал, есть ли подписчик Pro). Только у кого действует тариф."""
        now = now or time.time()
        result: dict[str, bool] = {}
        for r in self.q("SELECT f.channel, u.* FROM follows f JOIN users u ON u.id=f.user_id "
                        "WHERE f.channel NOT IN (SELECT channel FROM blocked_channels)"):
            plan = effective_plan(r["plan"], r["plan_until"], r["trial_until"], now)
            if plan is None or r["telegram_chat_id"] is None:
                continue
            result[r["channel"]] = result.get(r["channel"], False) or plan.priority
        # сначала каналы с Pro-подписчиками, потом по числу подписчиков
        counts = {r["channel"]: r["n"] for r in self.q("SELECT channel, COUNT(*) n FROM follows GROUP BY channel")}
        return sorted(result.items(), key=lambda kv: (not kv[1], -counts.get(kv[0], 0), kv[0]))

    def block_channel(self, channel: str) -> None:
        self.x("INSERT OR IGNORE INTO blocked_channels VALUES (?,?)", (channel, time.time()))
        self.x("DELETE FROM follows WHERE channel=?", (channel,))

    def is_blocked(self, channel: str) -> bool:
        return self.one("SELECT 1 FROM blocked_channels WHERE channel=?", (channel,)) is not None

    # ---------- клипы ----------
    def add_clip(self, **c) -> None:
        cols = ",".join(c)
        self.x(f"INSERT INTO clips ({cols}) VALUES ({','.join('?' * len(c))})", tuple(c.values()))

    def clip(self, clip_id: str) -> sqlite3.Row | None:
        return self.one("SELECT * FROM clips WHERE id=?", (clip_id,))

    def set_clip(self, clip_id: str, **fields) -> None:
        sets = ",".join(f"{k}=?" for k in fields)
        self.x(f"UPDATE clips SET {sets} WHERE id=?", (*fields.values(), clip_id))

    def received_in_stream(self, uid: int, stream_id: str) -> int:
        return self.one("SELECT COUNT(*) n FROM deliveries WHERE user_id=? AND stream_id=?", (uid, stream_id))["n"]

    def add_delivery(self, clip_id: str, uid: int, stream_id: str, sent: bool) -> None:
        self.x("INSERT OR REPLACE INTO deliveries VALUES (?,?,?,?,?)",
               (clip_id, uid, stream_id, time.time(), int(sent)))

    def user_clips(self, uid: int, limit: int = 100) -> list[sqlite3.Row]:
        return self.q("SELECT c.* FROM clips c JOIN deliveries d ON d.clip_id=c.id "
                      "WHERE d.user_id=? ORDER BY c.created DESC LIMIT ?", (uid, limit))

    def has_clip(self, uid: int, clip_id: str) -> bool:
        return self.one("SELECT 1 FROM deliveries WHERE user_id=? AND clip_id=?", (uid, clip_id)) is not None

    def clips_since(self, channel: str, since: float) -> int:
        return self.one("SELECT COUNT(*) n FROM clips WHERE channel=? AND created>=?", (channel, since))["n"]

    def old_clips(self, before: float) -> list[sqlite3.Row]:
        return self.q("SELECT * FROM clips WHERE created<?", (before,))

    def delete_clip(self, clip_id: str) -> None:
        self.x("DELETE FROM clips WHERE id=?", (clip_id,))
