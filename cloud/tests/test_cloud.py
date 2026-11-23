import asyncio
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hypecut.capture import Segment
from hypecut.detector import Trigger
from hypecut_cloud.api import create_app
from hypecut_cloud.bot import Bot
from hypecut_cloud.config import Config
from hypecut_cloud.db import DB, normalize_channel
from hypecut_cloud.plans import PLANS, can_receive, effective_plan
from hypecut_cloud.worker import ChannelWorker, Dispatcher, Manager

SECRET = "test-secret-0123456789abcdef0123456789"


class FakeTG:
    def __init__(self):
        self.messages, self.videos, self.uploads = [], [], 0

    async def send_message(self, chat_id, text, buttons=None):
        self.messages.append((chat_id, text))
        return True

    async def send_video(self, chat_id, caption, path=None, file_id=None):
        if not file_id:
            self.uploads += 1
            file_id = f"fid_{path.name}"
        self.videos.append((chat_id, file_id))
        return True, file_id


def msg(chat_id, text, username="u"):
    return {"message": {"chat": {"id": chat_id, "type": "private"}, "from": {"username": username}, "text": text}}


@pytest.fixture
def env(tmp_path):
    cfg = Config(data_dir=tmp_path, bot_username="HypeCutBot", jwt_secret=SECRET, dev_login=True,
                 revenuecat_secret="rc", admin_token="adm", public_url="http://x")
    cfg.clips_dir.mkdir(parents=True)
    db = DB(":memory:")
    tg = FakeTG()
    return cfg, db, tg


def test_normalize_channel():
    assert normalize_channel("https://www.twitch.tv/Some_Streamer?x=1") == "some_streamer"
    assert normalize_channel("@xQcOW") == "xqcow"
    assert normalize_channel("twitch.tv/abcd/videos") == "abcd"
    assert normalize_channel("привет") is None
    assert normalize_channel("a") is None


def test_effective_plan():
    now = 1000.0
    assert effective_plan(None, None, now + 10, now).id == "trial"
    assert effective_plan(None, None, now - 10, now) is None
    assert effective_plan("pro", now + 10, now - 10, now).id == "pro"
    assert effective_plan("pro", now - 10, now - 10, now) is None  # подписка закончилась
    assert can_receive(PLANS["trial"], 4) and not can_receive(PLANS["trial"], 5)
    assert can_receive(PLANS["pro"], 10_000)


def test_app_flow_login_link_follow(env):
    cfg, db, tg = env
    client = TestClient(create_app(cfg, db))
    r = client.post("/auth/dev", json={"name": "bak"}).json()
    h = {"Authorization": f"Bearer {r['token']}"}
    me = client.get("/me", headers=h).json()
    assert me["plan"]["id"] == "trial" and not me["telegram_linked"]

    link = client.post("/telegram/link", headers=h).json()["url"]
    assert link.startswith("https://t.me/HypeCutBot?start=")
    token = link.split("start=")[1]

    bot = Bot(cfg, db, tg)
    asyncio.run(bot.handle(msg(555, f"/start {token}")))
    assert "подключён" in tg.messages[-1][1]
    assert client.get("/me", headers=h).json()["telegram_linked"] is True

    assert client.post("/channels", json={"channel": "twitch.tv/StreamerOne"}, headers=h).json() == ["streamerone"]
    # пробный тариф: только 1 канал
    assert client.post("/channels", json={"channel": "two"}, headers=h).status_code == 400  # «two» слишком короткий
    assert client.post("/channels", json={"channel": "streamertwo"}, headers=h).status_code == 403
    assert client.get("/me").status_code == 401

    # ссылку нельзя использовать второй раз
    asyncio.run(bot.handle(msg(777, f"/start {token}")))
    assert "устарела" in tg.messages[-1][1]


def test_bot_only_user_then_merge_into_app_account(env):
    cfg, db, tg = env
    bot = Bot(cfg, db, tg)
    asyncio.run(bot.handle(msg(42, "/start")))
    asyncio.run(bot.handle(msg(42, "https://twitch.tv/coolguy")))
    assert "слежу за coolguy" in tg.messages[-1][1]
    assert db.wanted_channels() == [("coolguy", False)]

    app_user = db.upsert_user("google", "g1", "a@b.c")
    token = db.new_link_token(app_user["id"])
    asyncio.run(bot.handle(msg(42, f"/start {token}")))
    assert db.follows(app_user["id"]) == ["coolguy"]
    assert db.user_by_chat(42)["id"] == app_user["id"]
    assert db.one("SELECT COUNT(*) n FROM users")["n"] == 1


def test_billing_webhook_and_block(env):
    cfg, db, tg = env
    client = TestClient(create_app(cfg, db))
    u = db.upsert_user("apple", "a1")
    ev = {"event": {"type": "INITIAL_PURCHASE", "app_user_id": str(u["id"]), "product_id": "hypecut_pro_monthly",
                    "expiration_at_ms": (time.time() + 86400) * 1000}}
    assert client.post("/billing/revenuecat", json=ev).status_code == 401
    assert client.post("/billing/revenuecat", json=ev, headers={"Authorization": "Bearer rc"}).status_code == 200
    assert db.plan_of(db.user(u["id"])).id == "pro"
    client.post("/billing/revenuecat", json={"event": {"type": "EXPIRATION", "app_user_id": str(u["id"])}},
                headers={"Authorization": "Bearer rc"})
    assert db.plan_of(db.user(u["id"])).id == "trial"  # вернулся пробный, пока он не истёк

    db.follow(u["id"], "badchan")
    assert client.post("/admin/block", json={"channel": "badchan"}, headers={"X-Admin-Token": "adm"}).json()["ok"]
    assert db.follows(u["id"]) == [] and db.follow(u["id"], "badchan") == "blocked"


def _make_segments(tmp: Path) -> list[Segment]:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30",
                    "-f", "lavfi", "-i", "sine=frequency=440", "-t", "12", "-c:v", "libx264", "-g", "30",
                    "-c:a", "aac", "-f", "segment", "-segment_time", "4", "-reset_timestamps", "1",
                    str(tmp / "seg_%03d.ts")], check=True)
    now = time.time()
    files = sorted(tmp.glob("seg_*.ts"))
    return [Segment(p, now - 12 + i * 4, now - 12 + (i + 1) * 4) for i, p in enumerate(files)]


class FakeRecorder:
    def __init__(self, segments):
        self.segments, self.live, self.started_at = segments, True, segments[0].start

    def segments_between(self, s, e):
        return [x for x in self.segments if x.end > s and x.start < e]


def test_clip_made_once_and_sent_to_all_followers_with_limits(env, tmp_path):
    cfg, db, tg = env
    cfg.pre_roll, cfg.post_roll, cfg.segment_seconds = 6, 0, 0
    segs = _make_segments(tmp_path)
    users = []
    for i, (plan, chat) in enumerate([("pro", 1), (None, 2), ("standard", 3)]):
        u = db.upsert_user("dev", f"u{i}")
        db.x("UPDATE users SET telegram_chat_id=? WHERE id=?", (chat, u["id"]))
        if plan:
            db.set_plan(u["id"], plan, time.time() + 86400)
        assert db.follow(u["id"], "streamer") == "ok"
        users.append(u)
    # у второго пробный период закончился: ему клипы не приходят
    db.x("UPDATE users SET trial_until=0 WHERE id=?", (users[1]["id"],))

    disp = Dispatcher(cfg, db, tg)
    w = ChannelWorker(cfg, db, disp, "streamer", recorder=FakeRecorder(segs))
    clip_id = asyncio.run(w.make_clip(Trigger(at=segs[-1].end, reason="чат x5", score=5, kind="chat")))
    assert clip_id
    c = db.clip(clip_id)
    assert (cfg.clips_dir / c["file"]).exists() and c["vertical_file"]  # есть Pro: делаем 9:16
    assert sorted(ch for ch, _ in tg.videos) == [1, 3]
    assert tg.uploads == 1  # файл загружен в Telegram один раз, второму отправлен по file_id

    client = TestClient(create_app(cfg, db))
    from hypecut_cloud.auth import issue_session
    tok = issue_session(users[0]["id"], SECRET)
    clips = client.get("/clips", headers={"Authorization": f"Bearer {tok}"}).json()
    assert clips[0]["id"] == clip_id and clips[0]["vertical"]
    assert client.get(f"/clips/{clip_id}/video?token={tok}").status_code == 200
    other = issue_session(users[1]["id"], SECRET)
    assert client.get(f"/clips/{clip_id}/video?token={other}").status_code == 404

    cfg.clip_keep_days = 0
    assert Manager(cfg, db, disp).cleanup() == 1 and not (cfg.clips_dir / c["file"]).exists()


def test_manager_starts_and_stops_workers(env):
    cfg, db, tg = env

    class W:
        def __init__(self, ch):
            self.ch, self.running = ch, False

        def start(self):
            self.running = True

        async def stop(self):
            self.running = False

    async def go():
        m = Manager(cfg, db, Dispatcher(cfg, db, tg), worker_factory=W)
        u = db.upsert_user("dev", "x")
        db.x("UPDATE users SET telegram_chat_id=9 WHERE id=?", (u["id"],))
        db.follow(u["id"], "chan_a")
        await m.reconcile()
        assert list(m.workers) == ["chan_a"]
        w = m.workers["chan_a"]
        db.unfollow(u["id"], "chan_a")
        await m.reconcile()
        assert m.workers == {} and not w.running

    asyncio.run(go())


def test_telegram_api_reuses_file_id(tmp_path):
    import httpx
    from hypecut_cloud.telegram_api import TelegramAPI

    seen = []

    def handler(request: httpx.Request):
        seen.append((request.url.path, b"filename=" in request.content))
        return httpx.Response(200, json={"ok": True, "result": {"video": {"file_id": "F1"}}})

    async def go():
        api = TelegramAPI("T")
        api.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        f = tmp_path / "c.mp4"
        f.write_bytes(b"0" * 10)
        assert await api.send_video(1, "cap", path=f) == (True, "F1")
        assert await api.send_video(2, "cap", file_id="F1") == (True, "F1")
        await api.close()

    asyncio.run(go())
    assert seen == [("/botT/sendVideo", True), ("/botT/sendVideo", False)]
