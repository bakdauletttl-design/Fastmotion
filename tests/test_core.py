import asyncio
import subprocess
import time
from pathlib import Path

import pytest

from hypecut.capture import Segment
from hypecut.chat import parse_privmsg
from hypecut.clipper import build_clip, mean_volume
from hypecut.detector import AudioPeakDetector, ChatSpikeDetector, parse_mean_volume


def test_chat_spike_fires_on_burst_only():
    d = ChatSpikeDetector(window=10, multiplier=3, min_messages=15, hype_words=["kekw"], warmup_seconds=60)
    t = 1000.0
    fired = []
    # 2 минуты спокойного чата: 1 сообщение в секунду
    for i in range(120):
        if d.add_message("привет", t + i):
            fired.append(i)
    assert not fired
    # всплеск: 8 сообщений в секунду с KEKW
    hit = None
    for i in range(80):
        trig = d.add_message("KEKW KEKW", t + 120 + i / 8)
        if trig:
            hit = trig
            break
    assert hit is not None
    assert "чат" in hit.reason


def test_chat_quiet_channel_needs_min_messages():
    d = ChatSpikeDetector(window=10, multiplier=3, min_messages=15, warmup_seconds=0)
    t = 0.0
    for i in range(10):
        assert d.add_message("hi", t + i * 5) is None


def test_audio_peak():
    d = AudioPeakDetector(db_above=8, min_history=5)
    for i in range(10):
        assert d.add_level(-30.0, i) is None
    assert d.add_level(-20.0, 11) is not None


def test_parse_mean_volume():
    assert parse_mean_volume("[Parsed_volumedetect_0] mean_volume: -23.4 dB") == -23.4
    assert parse_mean_volume("nothing") is None


def test_parse_privmsg():
    line = "@badge-info=;color=#FF0000 :nick!nick@nick.tmi.twitch.tv PRIVMSG #chan :KEKW это жесть"
    assert parse_privmsg(line) == ("nick", "KEKW это жесть")
    assert parse_privmsg(":tmi.twitch.tv 001 justinfan :Welcome") is None


def test_segment_and_clip_with_ffmpeg(tmp_path: Path):
    """Режем тестовое видео на куски, как это делает запись, и собираем клип."""
    buf = tmp_path / "buf"
    buf.mkdir()
    subprocess.run([
        "ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440", "-t", "20",
        "-c:v", "libx264", "-g", "30", "-c:a", "aac", "-f", "mpegts", str(tmp_path / "src.ts"),
    ], check=True)
    subprocess.run([
        "ffmpeg", "-loglevel", "error", "-i", str(tmp_path / "src.ts"), "-c", "copy",
        "-f", "segment", "-segment_time", "4", "-reset_timestamps", "1",
        "-segment_list", str(buf / "list.csv"), "-segment_list_type", "csv",
        str(buf / "seg_%03d.ts"),
    ], check=True)
    rows = [l.split(",") for l in (buf / "list.csv").read_text().splitlines()]
    base = 10_000.0
    segs = [Segment(buf / r[0], base + float(r[1]), base + float(r[2])) for r in rows]
    assert len(segs) >= 4

    out = tmp_path / "clip.mp4"
    start, end = base + 5, base + 15
    asyncio.run(build_clip([s for s in segs if s.end > start and s.start < end], start, end, out))
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True).stdout)
    assert 9 <= dur <= 11.5

    level = asyncio.run(mean_volume(segs[0].path))
    assert level is not None and level < 0


def test_web_endpoints(tmp_path: Path):
    from fastapi.testclient import TestClient
    from hypecut.config import Settings
    from hypecut.web import create_app

    s = Settings(data_dir=tmp_path)
    client = TestClient(create_app(s, run_engine=False))
    assert client.get("/").status_code == 200
    st = client.get("/api/status").json()
    assert st["configured"] is False and st["live"] is False
    assert client.get("/api/clips").json() == []
    assert client.post("/api/clip").status_code == 409
    assert client.post("/api/settings", json={"channel": ""}).status_code == 400

    r = client.post("/api/settings", json={"channel": "https://www.twitch.tv/SomeStreamer",
                                           "pre_roll": "25", "audio_enabled": False, "hype_words": "kekw, pog"})
    assert r.status_code == 200
    saved = client.get("/api/settings").json()
    assert saved["channel"] == "somestreamer" and saved["pre_roll"] == 25 and saved["hype_words"] == ["kekw", "pog"]
    # настройки переживают перезапуск
    assert Settings(data_dir=tmp_path).__class__  # noqa
    s2 = Settings(data_dir=tmp_path); s2.load_saved()
    assert s2.channel == "somestreamer" and s2.audio_enabled is False


def test_recorder_and_engine_end_to_end(tmp_path: Path):
    """Подменяем Twitch тестовым видео в реальном времени и проверяем запись + нарезку."""
    from hypecut.config import Settings
    from hypecut.engine import Engine
    from hypecut.detector import Trigger

    def fake_open(self):
        p = subprocess.Popen([
            "ffmpeg", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=440", "-t", "30", "-c:v", "libx264", "-preset", "ultrafast",
            "-g", "30", "-c:a", "aac", "-f", "mpegts", "pipe:1"], stdout=subprocess.PIPE)
        return p.stdout

    async def scenario():
        s = Settings(channel="sim", data_dir=tmp_path, pre_roll=6, post_roll=3, segment_seconds=2)
        e = Engine(s)
        e.recorder.open_stream = fake_open.__get__(e.recorder)
        e.recorder.on_segment(e._on_segment)
        task = asyncio.create_task(e.recorder.run())
        await asyncio.sleep(10)
        assert e.recorder.live and e.last_level is not None
        assert e.fire(Trigger(time.time(), "тест", 1))
        await asyncio.sleep(7)
        task.cancel()
        return e

    e = asyncio.run(scenario())
    assert len(e.clips) == 1
    assert (tmp_path / "clips" / e.clips[0].file).stat().st_size > 10_000
