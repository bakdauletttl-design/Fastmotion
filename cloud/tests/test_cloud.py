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

    async def create_subscription_link(self, title, description, payload, stars):
        self.links = getattr(self, "links", []) + [(payload, stars)]
        return f"https://t.me/$inv_{payload}"

    async def answer_pre_checkout(self, query_id, ok, error=None):
        self.checkouts = getattr(self, "checkouts", []) + [(query_id, ok)]

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
    assert normalize_channel("https://www.twitch.tv/Some_Streamer?x=1") == "twitch:some_streamer"
    assert normalize_channel("@xQcOW") == "twitch:xqcow"
    assert normalize_channel("twitch.tv/abcd/videos") == "twitch:abcd"
    assert normalize_channel("привет") is None
    assert normalize_channel("a") is None


def test_other_platforms():
    from hypecut_cloud.sources import from_key, parse_source
    assert normalize_channel("https://www.youtube.com/@NightOwl/live") == "youtube:@nightowl"
    assert normalize_channel("youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA") == "youtube:UCX6OQ3DkcsbYNE6H8uQQuVA"
    assert normalize_channel("https://kick.com/Night-Owl") == "kick:night-owl"
    assert normalize_channel("https://live.vkvideo.ru/nightowl") == "vk:nightowl"
    assert normalize_channel("https://vkplay.live/nightowl") == "vk:nightowl"
    assert normalize_channel("https://www.tiktok.com/@night.owl/live") == "tiktok:@night.owl"
    assert normalize_channel("nightowl", "youtube") == "youtube:@nightowl"
    assert normalize_channel("nightowl", "kick") == "kick:nightowl"
    assert normalize_channel("https://example.com/nightowl") is None
    assert from_key("youtube:@nightowl").url == "https://www.youtube.com/@nightowl/live"
    assert from_key("tiktok:@night.owl").url == "https://www.tiktok.com/@night.owl/live"
    assert parse_source("kick.com/abc").has_chat is False
    assert parse_source("twitch.tv/abcd").has_chat is True


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
    assert "HypeCut" in client.get("/privacy").text
    assert client.get("/terms").status_code == 200
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

    assert client.post("/channels", json={"channel": "twitch.tv/StreamerOne"}, headers=h).json()[0]["key"] == "twitch:streamerone"
    assert client.get("/channels", headers=h).json()[0]["live"] is False
    # пробный тариф: только 1 канал
    assert client.post("/channels", json={"channel": "two"}, headers=h).status_code == 400  # «two» слишком короткий
    assert client.post("/channels", json={"channel": "streamertwo", "platform": "youtube"}, headers=h).status_code == 403
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
    assert db.wanted_channels() == [("twitch:coolguy", False)]

    app_user = db.upsert_user("google", "g1", "a@b.c")
    token = db.new_link_token(app_user["id"])
    asyncio.run(bot.handle(msg(42, f"/start {token}")))
    assert db.follows(app_user["id"]) == ["twitch:coolguy"]
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

    db.follow(u["id"], "twitch:badchan")
    assert client.post("/admin/block", json={"channel": "badchan"}, headers={"X-Admin-Token": "adm"}).json()["ok"]
    assert db.follows(u["id"]) == [] and db.follow(u["id"], "twitch:badchan") == "blocked"


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
        assert db.follow(u["id"], "youtube:@streamer") == "ok"
        users.append(u)
    # у второго пробный период закончился: ему клипы не приходят
    db.x("UPDATE users SET trial_until=0 WHERE id=?", (users[1]["id"],))

    disp = Dispatcher(cfg, db, tg)
    w = ChannelWorker(cfg, db, disp, "youtube:@streamer", recorder=FakeRecorder(segs))
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
    assert clips[0]["platform"] == "youtube" and clips[0]["channel"] == "streamer"
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
        db.follow(u["id"], "kick:chan_a")
        await m.reconcile()
        assert list(m.workers) == ["kick:chan_a"]
        w = m.workers["kick:chan_a"]
        db.unfollow(u["id"], "kick:chan_a")
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


def test_telegram_stars_subscription(env):
    cfg, db, tg = env
    bot = Bot(cfg, db, tg)
    asyncio.run(bot.handle(msg(77, "/start")))
    uid = db.user_by_chat(77)["id"]
    asyncio.run(bot.handle(msg(77, "/buy")))
    assert tg.links == [(f"plan:standard:{uid}", 650), (f"plan:pro:{uid}", 1300)]

    # Telegram спрашивает, можно ли принять оплату: неверная сумма отклоняется
    asyncio.run(bot.handle({"pre_checkout_query": {"id": "q1", "currency": "XTR", "total_amount": 1,
                                                   "invoice_payload": f"plan:pro:{uid}"}}))
    asyncio.run(bot.handle({"pre_checkout_query": {"id": "q2", "currency": "XTR", "total_amount": 1300,
                                                   "invoice_payload": f"plan:pro:{uid}"}}))
    assert tg.checkouts == [("q1", False), ("q2", True)]

    until = int(time.time()) + 30 * 86400
    pay = {"currency": "XTR", "total_amount": 1300, "invoice_payload": f"plan:pro:{uid}",
           "subscription_expiration_date": until, "is_recurring": True, "is_first_recurring": True,
           "telegram_payment_charge_id": "ch1"}
    asyncio.run(bot.handle({"message": {"chat": {"id": 77, "type": "private"}, "successful_payment": pay}}))
    u = db.user(uid)
    assert db.plan_of(u).id == "pro" and u["plan_until"] == until
    assert "оформлена" in tg.messages[-1][1]
    assert db.one("SELECT charge_id FROM payments")["charge_id"] == "ch1"


def test_enhance_titles_subtitles_and_vertical(tmp_path, monkeypatch):
    import subprocess
    from hypecut_cloud import enhance as e

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert e.simple_title("", ["a: KEKW", "b: kekw", "c: ну"], "чат x5") == "Чат: «KEKW» ×2"
    assert e.simple_title("я не верю что это сработало вообще", [], "звук").startswith("«я не верю")
    assert e.make_title("x", "", [], "звук +9 dB") == "звук +9 dB"

    words = [e.Word(0.1, 0.4, "раз"), e.Word(0.4, 0.8, "два"), e.Word(0.8, 1.0, "три"),
             e.Word(1.0, 1.3, "четыре"), e.Word(3.0, 3.4, "{пауза}")]
    assert [len(c) for c in e.chunks(words)] == [3, 1, 1]
    ass = e.write_ass(words, tmp_path / "s.ass")
    text = ass.read_text(encoding="utf-8")
    assert text.count("Dialogue:") == 5 and "(ПАУЗА)" in text and e.ACCENT_ASS in text

    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=2:r=15",
                    "-f", "lavfi", "-i", "sine=d=2", "-shortest", "-c:v", "libx264", "-c:a", "aac", str(src)],
                   check=True)
    for layout in (e.Layout("split", box=(400, 200, 200, 118), src_w=640, src_h=360),
                   e.Layout("follow", cx=600, src_w=640, src_h=360), e.Layout("blur")):
        monkeypatch.setattr(e, "find_layout", lambda v, l=layout: l)
        out = e.make_vertical(src, tmp_path / f"{layout.kind}.mp4", words)
        assert out and out.stat().st_size > 0
        probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                "stream=width,height", "-of", "csv=p=0", str(out)],
                               capture_output=True, text=True).stdout.strip()
        assert probe == "1080,1920"


def test_push_tokens_live_announce_and_clip_push(env):
    import httpx
    from hypecut_cloud.push import Push

    cfg, db, tg = env
    sent = []

    def handler(request):
        msgs = __import__("json").loads(request.content)
        sent.extend(msgs)
        return httpx.Response(200, json={"data": [
            {"status": "error", "details": {"error": "DeviceNotRegistered"}} if "dead" in m["to"] else {"status": "ok"}
            for m in msgs]})

    push = Push(db, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    client = TestClient(create_app(cfg, db))
    tok = client.post("/auth/dev", json={"name": "a"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.post("/push/token", json={"token": "bad"}, headers=h).status_code == 400
    for t in ("ExponentPushToken[ok1]", "ExponentPushToken[dead]"):
        assert client.post("/push/token", json={"token": t}, headers=h).json()["ok"]
    uid = client.get("/me", headers=h).json()["id"]
    db.follow(uid, "twitch:streamer")

    d = Dispatcher(cfg, db, tg, push)
    assert asyncio.run(d.announce_live("twitch:streamer")) == 1
    assert len(sent) == 2 and "в эфире" in sent[0]["title"]
    assert db.push_tokens([uid]) == ["ExponentPushToken[ok1]"]  # мёртвый токен удалён


def test_twitch_search_avatars_and_viewer_signal(env):
    import httpx
    from hypecut_cloud.twitch import Twitch

    cfg, db, tg = env
    calls = []

    def handler(req):
        calls.append(req.url.path)
        if req.url.host == "id.twitch.tv":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if req.url.path.endswith("/search/channels"):
            return httpx.Response(200, json={"data": [
                {"broadcaster_login": "offguy", "display_name": "OffGuy", "thumbnail_url": "a1", "is_live": False},
                {"broadcaster_login": "liveguy", "display_name": "LiveGuy", "thumbnail_url": "a2", "is_live": True,
                 "game_name": "CS2"}]})
        if req.url.path.endswith("/users"):
            logins = req.url.params.get_list("login")
            return httpx.Response(200, json={"data": [
                {"id": "42", "login": x, "display_name": x.title(), "profile_image_url": f"img/{x}"} for x in logins]})
        if req.url.path.endswith("/clips"):
            return httpx.Response(200, json={"data": [{}, {}, {}]})
        return httpx.Response(404)

    tw = Twitch("id", "secret", httpx.Client(transport=httpx.MockTransport(handler)))
    client = TestClient(create_app(cfg, db, twitch=tw))
    tok = client.post("/auth/dev", json={"name": "a"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    found = client.get("/search", params={"q": "guy"}, headers=h).json()
    assert [x["name"] for x in found] == ["liveguy", "offguy"] and found[0]["game"] == "CS2"
    client.post("/channels", json={"channel": "twitch.tv/streamer"}, headers=h)
    ch = client.get("/channels", headers=h).json()
    assert ch[0]["avatar"] == "img/streamer" and ch[0]["display"] == "Streamer"
    assert any(x["avatar"] for x in client.get("/popular").json())
    assert tw.recent_clips("streamer", time.time() - 120) == 3
    assert calls.count("/helix/users") == 2  # каналы и популярные; для клипов id взят из кэша
    assert ChannelWorker.viewer_trigger(1, 1000) is None
    trig = ChannelWorker.viewer_trigger(3, 1000)
    assert trig.kind == "viewers" and trig.at == 970
    assert Twitch("", "").search("x") == []


def test_errors_in_english_for_english_phones(env):
    cfg, db, tg = env
    client = TestClient(create_app(cfg, db))
    assert client.get("/me").json()["detail"] == "Нужно войти"
    assert client.get("/me", headers={"Accept-Language": "en"}).json()["detail"] == "Please sign in"
