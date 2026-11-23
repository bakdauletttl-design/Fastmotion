"""Анонимное чтение чата Twitch по IRC (логин и токен не нужны)."""
from __future__ import annotations

import asyncio
import logging
import random
import ssl
from typing import AsyncIterator

log = logging.getLogger(__name__)

HOST, PORT = "irc.chat.twitch.tv", 6697


def parse_privmsg(line: str) -> tuple[str, str] | None:
    """Возвращает (ник, текст) для строки PRIVMSG, иначе None."""
    if " PRIVMSG " not in line:
        return None
    if line.startswith("@"):
        line = line.split(" ", 1)[1]
    try:
        prefix, rest = line[1:].split(" PRIVMSG ", 1)
        _, text = rest.split(" :", 1)
    except ValueError:
        return None
    return prefix.split("!", 1)[0], text.strip()


async def chat_messages(channel: str) -> AsyncIterator[tuple[str, str]]:
    """Бесконечный поток (ник, текст) с автопереподключением."""
    while True:
        try:
            reader, writer = await asyncio.open_connection(
                HOST, PORT, ssl=ssl.create_default_context())
            nick = f"justinfan{random.randint(10000, 99999)}"
            writer.write(f"NICK {nick}\r\nJOIN #{channel}\r\n".encode())
            await writer.drain()
            log.info("Подключились к чату #%s", channel)
            while True:
                raw = await asyncio.wait_for(reader.readline(), timeout=360)
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip("\r\n")
                if line.startswith("PING"):
                    writer.write(line.replace("PING", "PONG", 1).encode() + b"\r\n")
                    await writer.drain()
                    continue
                msg = parse_privmsg(line)
                if msg:
                    yield msg
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("Чат отключился: %s", e)
        await asyncio.sleep(5)
