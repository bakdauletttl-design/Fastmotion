"""Длинные видео: сценарии, поиск моментов, источники, часы обработки, тарифы из конфига."""
import subprocess

import pytest
from fastapi.testclient import TestClient

from hypecut_cloud.api import create_app
from hypecut_cloud.config import Config
from hypecut_cloud.db import DB
from hypecut_cloud.pipeline import connectors
from hypecut_cloud.pipeline.analysis import find_highlights, sentences
from hypecut_cloud.pipeline.engine import Engine
from hypecut_cloud.pipeline.scenarios import SCENARIOS, pick
from hypecut_cloud.plans import PLANS, pricing_public

SECRET = "test-secret-0123456789abcdef0123456789"


def speech(lines, gap=1.2):
    """[(текст, кто)] -> слова с таймингом и реплики спикеров, по 0.4 с на слово."""
    words, turns, t = [], [], 0.0
    for text, who in lines:
        a = t
        for w in text.split():
            words.append((t, t + 0.35, w))
            t += 0.4
        turns.append((a, t, who))
        t += gap
    return words, turns, t


PODCAST = [("Привет всем, сегодня в гостях Алексей.", "A"), ("Расскажи, как ты начинал?", "A"),
           ("Ну это было давно, я работал на заводе и копил деньги.", "B"), ("Ничего особенного, обычная жизнь.", "B"),
           ("Хорошо, понятно.", "A"), ("Погода сегодня нормальная, кстати.", "A"), ("Да, тепло.", "B"),
           ("Мы ещё вернёмся к этому позже.", "A"), ("Ладно, давай дальше.", "B"),
           ("Главное, что я понял: время дороже денег, деньги можно заработать снова, а время никогда!", "B"),
           ("Ахахах, это точно.", "A"), ("Ладно, спасибо, что пришёл.", "A")]
MEETING = [("Всем привет, начинаем планёрку.", "A"), ("По цифрам за неделю всё ровно.", "B"),
           ("Клиент спросил, сколько стоит на сто человек?", "B"), ("Надо посчитать.", "A"),
           ("Мы обсудили варианты и цены.", "A"), ("Хорошо, тогда решили: запускаем в феврале, дедлайн первого числа.", "A"),
           ("Отлично.", "B"), ("Всем спасибо.", "A")]


def test_scenarios_pick_by_source():
    assert pick("auto", "meeting").id == "meeting" and pick("auto", "event").id == "event"
    assert pick("auto", "upload").id == "podcast" and pick("lecture", "upload").id == "lecture"
    assert set(SCENARIOS) == {"stream", "podcast", "interview", "lecture", "webinar", "meeting", "event"}


def test_sentences_split_by_speaker_and_signals():
    words, turns, _ = speech(PODCAST)
    s = sentences(words, turns)
    assert len(s) == len(PODCAST)
    assert s[1].speaker == "A" and s[2].speaker == "B" and s[2].signals.get("speaker_change")
    assert "quote" in s[9].signals and "laughter" in s[10].signals


def test_podcast_finds_the_quote_first():
    words, turns, end = speech(PODCAST)
    hs = find_highlights(words, SCENARIOS["podcast"], turns, duration=end)
    assert hs, "должен найтись хотя бы один момент"
    best = hs[0]
    assert "время дороже денег" in best.quote and best.speaker == "B"
    assert "quote" in best.signals and best.score >= 70
    assert SCENARIOS["podcast"].min_len - 1 <= best.end - best.start <= SCENARIOS["podcast"].max_len + 1
    # моменты не пересекаются
    spans = sorted((h.start, h.end) for h in hs)
    assert all(a[1] <= b[0] for a, b in zip(spans, spans[1:]))


def test_meeting_prefers_decision():
    words, turns, end = speech(MEETING)
    hs = find_highlights(words, SCENARIOS["meeting"], turns, duration=end)
    assert hs and "decision" in hs[0].signals and "февраль" in hs[0].quote.lower().replace("феврале", "февраль")


def test_url_check_blocks_internal_and_unknown_sites():
    assert connectors.check_url("https://www.youtube.com/watch?v=abc")
    assert connectors.check_url("https://cdn.example.com/talk.mp4")
    for bad in ("http://localhost/x.mp4", "http://127.0.0.1/a.mp4", "file:///etc/passwd", "https://example.com/page"):
        with pytest.raises(connectors.SourceError):
            connectors.check_url(bad)


def test_pricing_comes_from_config():
    p = pricing_public()
    assert [x["id"] for x in p["plans"]] == ["free", "creator", "pro", "agency", "business"]
    assert p["preliminary"] is True and p["kzt_per_usd"] > 0 and p["yearly_discount"] is None
    assert [a["hours"] for a in p["addons"]] == [10, 30, 100]
    assert PLANS["creator"].founder_usd == 9.99 and PLANS["agency"].hours == 200 and PLANS["business"].price_usd is None
    assert PLANS["free"].watermark and not PLANS["pro"].watermark


def test_app_and_web_prices_are_separate():
    app, web = pricing_public("app"), pricing_public("web")
    price = lambda p, i: next(x for x in p["plans"] if x["id"] == i)
    assert [price(app, i)["price_usd"] for i in ("creator", "pro", "agency")] == [17.99, 34.99, 119]
    assert [price(web, i)["price_usd"] for i in ("creator", "pro", "agency")] == [14.99, 29.99, 99]
    assert price(web, "creator")["founder_usd"] == 9.99 and price(app, "creator")["founder_usd"] > 9.99
    assert price(app, "free")["price_usd"] == 0
    # приложение не должно видеть цены сайта, а сайт — цены магазина
    assert "14.99" not in str(app) and "17.99" not in str(web) and "app_usd" not in str(app)
    assert app["addons"][0]["price_usd"] > web["addons"][0]["price_usd"]


@pytest.fixture
def app(tmp_path):
    cfg = Config(data_dir=tmp_path, jwt_secret=SECRET, dev_login=True, public_url="http://x")
    cfg.clips_dir.mkdir(parents=True)
    db = DB(":memory:")
    client = TestClient(create_app(cfg, db))
    tok = client.post("/auth/dev", json={"name": "a"}).json()["token"]
    return cfg, db, client, {"Authorization": f"Bearer {tok}"}


def test_hours_limit_and_packs(app):
    cfg, db, client, h = app
    uid = db.q("SELECT id FROM users")[0]["id"]
    assert client.get("/me", headers=h).json()["usage"]["hours_used"] == 0
    db.spend_hours(uid, PLANS["trial"], 2.0)  # пробный: 2 часа, как Free
    body = {"kind": "url", "url": "https://youtube.com/watch?v=abc", "rights": True}
    assert client.post("/sources", json=body, headers=h).status_code == 402
    assert client.post("/billing/hours", json={"id": "h10"}, headers=h).json()["ok"]
    r = client.post("/sources", json=body, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "queued" and r.json()["platform"] == "youtube"
    db.spend_hours(uid, PLANS["trial"], 3.0)  # тариф уже кончился: всё из пакета
    assert db.hours(uid)["hours_extra"] == 7.0
    assert client.post("/sources", json={**body, "rights": False}, headers=h).status_code == 400


def test_meeting_needs_connected_service(app):
    cfg, db, client, h = app
    items = client.get("/integrations", headers=h).json()
    assert [x["id"] for x in items] == ["zoom", "meet", "teams"] and not any(x["connected"] for x in items)
    assert client.post("/integrations/zoom/connect", headers=h).status_code == 503  # ключей Zoom на сервере нет
    assert client.post("/sources", json={"kind": "meeting", "platform": "zoom", "recording": "r1"}, headers=h).status_code == 400


def test_upload_to_clips_in_queue(app, monkeypatch):
    """Загрузка -> движок -> клипы с цитатой и спикером в общей очереди -> принять."""
    cfg, db, client, h = app
    words, turns, end = speech(PODCAST, gap=1.0)
    video = cfg.data_dir / "talk.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=s=640x360:d={end + 2:.0f}:r=15",
                    "-f", "lavfi", "-i", f"sine=frequency=300:d={end + 2:.0f}", "-shortest", "-c:v", "libx264",
                    "-preset", "ultrafast", "-c:a", "aac", str(video)], check=True)
    up = client.post("/uploads?kind=source", content=video.read_bytes(), headers=h).json()["id"]
    r = client.post("/sources", json={"kind": "upload", "upload": up, "scenario": "podcast", "title": "Подкаст #1"}, headers=h).json()
    assert r["status"] == "queued" and r["platform"] == "file"
    eng = Engine(db, cfg.clips_dir, upload_path=lambda uid, upid: cfg.clips_dir / "uploads" / f"u{uid}_{upid}.mp4",
                 transcribe=lambda path: words, diarizer=lambda path: turns, review=lambda hs, sc, title: hs)
    eng.run(r["id"])
    src = client.get("/sources", headers=h).json()[0]
    assert src["status"] == "done", src["error"]
    assert src["clips"] >= 1 and src["speakers"] == ["A", "B"] and src["duration"] > 20
    clips = [c for c in client.get("/clips", headers=h).json() if c.get("source_id") == r["id"]]
    assert clips and clips[0]["status"] == "pending" and clips[0]["source_kind"] == "upload"
    best = max(clips, key=lambda c: c["score"])
    assert "время дороже денег" in best["quote"] and best["speaker"] == "B" and "quote" in best["signals"]
    assert best["channel"] == "Подкаст #1" and best["platform_title"] == "Видео"
    assert client.get(f"/clips/{best['id']}/video", headers=h).status_code == 200
    assert client.post(f"/clips/{best['id']}/review", json={"status": "approved"}, headers=h).json()["ok"]
    assert db.clip(best["id"])["status"] == "approved"
    uid = db.q("SELECT id FROM users")[0]["id"]
    assert db.hours(uid)["hours_used"] > 0 and db.hours(uid)["ai_clips_used"] == src["clips"]
    assert not (cfg.clips_dir / "uploads" / f"u{uid}_{up}.mp4").exists()  # исходник удалён после нарезки


def test_streamer_optout_flow(app):
    cfg, db, client, h = app
    cfg.admin_token = "adm"
    assert "Для стримеров" in client.get("/streamers").text
    assert client.post("/streamers/request", json={"channel": "twitch.tv/NightOwl", "contact": "@owl", "owner": False}).status_code == 400
    r = client.post("/streamers/request", json={"channel": "twitch.tv/NightOwl", "contact": "@owl", "owner": True})
    assert r.json()["channel"] == "twitch:nightowl"
    reqs = client.get("/admin/requests?token=adm").json()
    assert len(reqs) == 1 and reqs[0]["contact"] == "@owl"
    (cfg.clips_dir / "c1.mp4").write_bytes(b"x")
    db.add_clip(id="c1", channel="twitch:nightowl", stream_id="s", file="c1.mp4", created=0)
    r = client.post("/admin/block", json={"channel": "twitch:nightowl"}, headers={"X-Admin-Token": "adm"}).json()
    assert r["clips_removed"] == 1 and not (cfg.clips_dir / "c1.mp4").exists() and db.is_blocked("twitch:nightowl")
    assert client.get("/admin/requests?token=adm").json() == []
