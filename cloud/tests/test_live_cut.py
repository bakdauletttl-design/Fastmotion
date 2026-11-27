"""Свой отрывок из эфира (начало и конец), сборка клипа с первого кадра и версии клипа для плеера."""
import asyncio
import json
import subprocess
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hypecut.capture import Segment
from hypecut.clipper import build_clip, keyframes, snap_to_keyframe
from hypecut_cloud import variants
from hypecut_cloud.api import create_app
from hypecut_cloud.auth import issue_session
from hypecut_cloud.config import Config
from hypecut_cloud.db import DB
from hypecut_cloud.worker import ChannelWorker, Dispatcher

SECRET = "test-secret-0123456789abcdef0123456789"
KEY = "twitch:streamer"


def probe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,start_time:format=duration",
                          "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    return {"duration": float(d["format"]["duration"]),
            **{s["codec_type"]: float(s["start_time"]) for s in d["streams"]}}


def make_live_segments(tmp: Path, total: int = 24, seg: int = 4) -> list[Segment]:
    """Как запись эфира: H.264 с B-кадрами, ключевой кадр раз в 2 с (как на Twitch), куски по 4 с."""
    src = tmp / "src.ts"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", str(total),
                    "-c:v", "libx264", "-preset", "ultrafast", "-bf", "2", "-g", "60", "-sc_threshold", "0",
                    "-c:a", "aac", "-f", "mpegts", str(src)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(src), "-map", "0:v:0", "-map", "0:a:0", "-c", "copy",
                    "-f", "segment", "-segment_time", str(seg), "-reset_timestamps", "1",
                    str(tmp / "seg_%06d.ts")], check=True)
    now = time.time()
    files = sorted(tmp.glob("seg_*.ts"))
    return [Segment(p, now - total + i * seg, now - total + (i + 1) * seg) for i, p in enumerate(files)]


class FakeRecorder:
    def __init__(self, segments):
        self.segments, self.live, self.started_at = segments, True, segments[0].start

    def segments_between(self, s, e):
        return [x for x in self.segments if x.end > s and x.start < e]


@pytest.fixture(scope="module")
def segments(tmp_path_factory):
    return make_live_segments(tmp_path_factory.mktemp("live"))


@pytest.fixture
def live_env(tmp_path, segments):
    cfg = Config(data_dir=tmp_path, jwt_secret=SECRET, dev_login=True, public_url="http://wrong-ip:8080")
    cfg.segment_seconds = 0
    cfg.clips_dir.mkdir(parents=True)
    db = DB(":memory:")
    u = db.upsert_user("dev", "viewer")
    db.set_plan(u["id"], "standard", time.time() + 86400)  # до 60 с
    assert db.follow(u["id"], KEY) == "ok"
    w = ChannelWorker(cfg, db, Dispatcher(cfg, db, None), KEY, recorder=FakeRecorder(segments))
    client = TestClient(create_app(cfg, db, live=lambda k: w if k == KEY else None))
    h = {"Authorization": f"Bearer {issue_session(u['id'], SECRET)}"}
    return cfg, db, client, h, w


def test_clip_starts_with_picture_not_only_sound(tmp_path, segments):
    """Раньше при -c copy видео начиналось только со следующего ключевого кадра: 1–2 с был один звук."""
    frames = keyframes(segments[1].path)
    assert frames and frames[0] < 0.1 and any(1.9 < k < 2.1 for k in frames)
    assert snap_to_keyframe(1.3, frames) == frames[0] and snap_to_keyframe(2.5, frames) > 1.9
    for start_in_seg in (0.0, 1.3, 2.5):
        start = segments[1].start + start_in_seg
        end = start + 6
        info = {}
        out = asyncio.run(build_clip([s for s in segments if s.end > start and s.start < end], start, end,
                                     tmp_path / f"c{start_in_seg}.mp4", info=info))
        p = probe(out)
        assert p["video"] < 0.2 and p["audio"] < 0.2, p  # картинка с первой секунды
        assert start - 2.1 <= info["start"] <= start + 0.01  # начало сдвинуто назад не больше чем на ключевой кадр
        assert abs(p["duration"] - (end - info["start"])) < 0.4, (p, end - info["start"])


def test_cut_with_chosen_start_and_end(live_env):
    cfg, db, client, h, w = live_env
    r = client.get(f"/live/{KEY}", headers=h).json()
    assert r["live"] and r["min_seconds"] == 3 and 20 <= r["buffer_seconds"] <= 24.5
    # отрывок с 15 до 5 секунд назад
    r = client.post(f"/live/{KEY}/clip", headers=h, json={"start_ago": 15, "end_ago": 5})
    assert r.status_code == 200, r.text
    clip = r.json()
    assert 10 <= clip["duration"] <= 12.1  # 10 с плюс до 2 с назад до ключевого кадра
    c = db.clip(clip["id"])
    p = probe(cfg.clips_dir / c["file"])
    assert p["video"] < 0.2 and abs(p["duration"] - c["duration"]) < 0.4
    # видео отдаётся по адресу, которым открыли сервер, а не по PUBLIC_URL (в локальном тесте)
    assert clip["video"].startswith("http://testserver/clips/")


@pytest.mark.parametrize("body,code,text", [
    ({"start_ago": 5, "end_ago": 15}, 400, "раньше конца"),
    ({"start_ago": 10, "end_ago": 10}, 400, "раньше конца"),
    ({"start_ago": 7, "end_ago": 5}, 400, "короткий"),
    ({"start_ago": 15}, 400, "и начало, и конец"),
    ({"start_ago": 100, "end_ago": 90}, 409, "удалён"),
    ({"start_ago": 40, "end_ago": 5}, 409, "не раньше"),
    ({"start_ago": 10, "end_ago": -1}, 422, None),
])
def test_cut_range_checks(live_env, body, code, text):
    cfg, db, client, h, w = live_env
    r = client.post(f"/live/{KEY}/clip", headers=h, json=body)
    assert r.status_code == code, r.text
    if text:
        assert text in r.json()["detail"]


def test_cut_range_longer_than_allowed(live_env):
    cfg, db, client, h, w = live_env
    cfg.buffer_seconds = 30  # самый длинный отрывок = буфер − 20 с = 10 с
    r = client.post(f"/live/{KEY}/clip", headers=h, json={"start_ago": 16, "end_ago": 1})
    assert r.status_code == 400 and "до 10 с" in r.json()["detail"]
    r = client.post(f"/live/{KEY}/clip", headers=h, json={"start_ago": 11.5, "end_ago": 1})  # +погрешность 1 с
    assert r.status_code == 200, r.text
    assert r.json()["duration"] <= 12.1


def test_cut_rejects_nan(live_env):
    cfg, db, client, h, w = live_env
    r = client.post(f"/live/{KEY}/clip", headers={**h, "content-type": "application/json"},
                    content='{"start_ago": NaN, "end_ago": 1}')
    assert r.status_code == 422


def test_cut_start_slightly_before_buffer_is_clamped(live_env):
    """Плеер и сервер расходятся на долю секунды: начало чуть раньше памяти эфира не ошибка."""
    cfg, db, client, h, w = live_env
    avail = w.live_edge() - w.buffer_start()
    r = client.post(f"/live/{KEY}/clip", headers=h, json={"start_ago": avail + 0.5, "end_ago": avail - 8})
    assert r.status_code == 200, r.text
    assert 7.5 <= r.json()["duration"] <= 8.6


def test_cut_button_last_seconds_still_works(live_env):
    cfg, db, client, h, w = live_env
    r = client.post(f"/live/{KEY}/clip", headers=h, json={"seconds": 8, "behind": 2})
    assert r.status_code == 200, r.text
    assert 8 <= r.json()["duration"] <= 10.1
    # сразу второй клип: просим подождать
    r = client.post(f"/live/{KEY}/clip", headers=h, json={"seconds": 8})
    assert r.status_code == 429


def test_cut_button_more_than_buffer(live_env):
    cfg, db, client, h, w = live_env
    w.recorder.segments = w.recorder.segments[-2:]  # эфир только начался: в памяти 8 с
    r = client.post(f"/live/{KEY}/clip", headers=h, json={"seconds": 30})
    assert r.status_code == 200, r.text
    assert 7 <= r.json()["duration"] <= 8.5


def test_parallel_requests_make_one_complete_file(tmp_path, monkeypatch):
    """Плеер браузера шлёт несколько запросов сразу. Раньше два ffmpeg писали в один файл → битое видео."""
    calls = []

    def slow_vertical(src, out, *a, **k):
        calls.append(out)
        with open(out, "wb") as f:
            for i in range(5):
                f.write(b"x" * 1000)
                f.flush()
                time.sleep(0.05)
        return out

    monkeypatch.setattr(variants.enhance, "make_vertical", slow_vertical)
    (tmp_path / "c1.mp4").write_bytes(b"src")
    clip = {"id": "c1", "file": "c1.mp4", "height": 720, "trim_start": 0, "trim_end": 0, "duration": 10,
            "words": "[]", "title": None, "moment": 2}
    want = variants.Want(720, False, True)
    got, seen = [], []

    def get():
        p = variants.path_for(tmp_path, clip, want)
        got.append(p)
        seen.append(p.stat().st_size)

    ts = [threading.Thread(target=get) for _ in range(4)]
    for t in ts:
        t.start()
    time.sleep(0.08)
    # пока файл делается, под настоящим именем его ещё нет: никто не получит половину
    assert not (tmp_path / variants.name_for("c1", want)).exists()
    for t in ts:
        t.join()
    assert len(calls) == 1 and set(seen) == {5000}
    assert all(p == tmp_path / variants.name_for("c1", want) for p in got)
    assert not list(tmp_path.glob(".tmp_*"))


def test_failed_render_leaves_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr(variants.enhance, "make_vertical", lambda src, out, *a, **k: (out.write_bytes(b"half"), None)[1])
    (tmp_path / "c2.mp4").write_bytes(b"src")
    clip = {"id": "c2", "file": "c2.mp4", "height": 720, "trim_start": 0, "trim_end": 0, "duration": 10,
            "words": "[]", "title": None, "moment": 2}
    assert variants.path_for(tmp_path, clip, variants.Want(720, False, True)) is None
    assert list(tmp_path.iterdir()) == [tmp_path / "c2.mp4"]


# ---------- запас до и после нажатия «Клип» ----------

def capture_cut(w):
    calls = []

    async def fake(uid, start_ago, end_ago):
        calls.append((round(start_ago, 2), round(end_ago, 2)))
        return None  # клип не нужен, проверяем только границы
    w.cut_range = fake
    return calls


def test_clip_button_default_20_before_10_after(live_env):
    cfg, db, client, h, w = live_env
    calls = capture_cut(w)
    client.post(f"/live/{KEY}/clip", headers=h, json={})
    assert calls[-1] == (20, -10)  # 20 с до нажатия и 10 с после (их сервер дождётся)
    # плеер отстаёт на 3 с: всё сдвигается на 3 с назад
    time.sleep(3.1)
    client.post(f"/live/{KEY}/clip", headers=h, json={"behind": 3})
    assert calls[-1] == (23, -7)
    me = client.get("/me", headers=h).json()["clip_timing"]
    assert me["before"] == 20 and me["after"] == 10 and me["before_choices"] == [10, 20, 30]


def test_clip_timing_setting_and_per_channel(live_env):
    cfg, db, client, h, w = live_env
    calls = capture_cut(w)
    assert client.put("/me/clip-timing", headers=h, json={"before": 15, "after": 10}).status_code == 400
    assert client.put("/me/clip-timing", headers=h, json={"before": 10, "after": 5}).status_code == 400
    assert client.put("/me/clip-timing", headers=h, json={"before": 10, "after": 0, "channel": "twitch:nobody"}).status_code == 404
    r = client.put("/me/clip-timing", headers=h, json={"before": 10, "after": 0})
    assert r.status_code == 200 and r.json()["before"] == 10 and r.json()["after"] == 0
    client.post(f"/live/{KEY}/clip", headers=h, json={})
    assert calls[-1] == (10, 0)
    # своя настройка для канала важнее общей
    r = client.put("/me/clip-timing", headers=h, json={"before": 30, "after": 20, "channel": KEY})
    assert r.status_code == 200
    assert client.get(f"/live/{KEY}", headers=h).json()["clip_timing"]["after"] == 20
    assert client.get("/me", headers=h).json()["clip_timing"]["before"] == 10
    time.sleep(3.1)
    client.post(f"/live/{KEY}/clip", headers=h, json={})
    assert calls[-1] == (min(30, w.live_edge() - w.buffer_start()), -20)
    # разовые before/after в запросе важнее настройки
    time.sleep(3.1)
    client.post(f"/live/{KEY}/clip", headers=h, json={"before": 10, "after": 10})
    assert calls[-1] == (10, -10)


def test_clip_timing_respects_plan(live_env):
    cfg, db, client, h, w = live_env
    calls = capture_cut(w)
    uid = db.user(1)["id"]
    assert client.put("/me/clip-timing", headers=h, json={"before": 30, "after": 20}).status_code == 200  # Standard: до 60 с
    db.set_plan(uid, "trial", time.time() + 86400)  # тариф стал меньше: до 30 с
    db.x("UPDATE users SET plan=NULL WHERE id=?", (uid,))
    r = client.put("/me/clip-timing", headers=h, json={"before": 30, "after": 10})
    assert r.status_code == 400 and "до 30 с" in r.json()["detail"]
    client.post(f"/live/{KEY}/clip", headers=h, json={})
    assert calls[-1] == (10, -20)  # сохранённые 30 + 20 ужались до 30 с: «до» укоротилось


def test_after_press_waits_for_stream(live_env, monkeypatch):
    """«После нажатия» ещё нет в эфире: сервер ждёт эти секунды, прежде чем резать."""
    from hypecut_cloud import worker as worker_mod
    cfg, db, client, h, w = live_env
    waits = []

    async def fake_sleep(sec):
        waits.append(sec)
    monkeypatch.setattr(worker_mod.asyncio, "sleep", fake_sleep)
    shift = time.time() - w.live_edge()  # эфир «прямо сейчас»: самый свежий кусок только что дописан
    w.recorder = FakeRecorder([Segment(x.path, x.start + shift, x.end + shift) for x in w.recorder.segments])
    asyncio.run(w.cut_range(1, 8, -10))
    assert waits and 10.5 <= waits[0] <= 11.1  # 10 с «после» + 1 с запаса на дописывание куска
