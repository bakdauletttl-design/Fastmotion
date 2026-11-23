// Демо-режим: приложение работает без сервера, на примерах. Включается в веб-версии
// или переменной EXPO_PUBLIC_DEMO=1. Видео лежат рядом со страницей в папке demo/.
import { L } from "./i18n";

const now = () => Date.now() / 1000;
const plan = (id: string, title: string, price_usd: number, channels: number, clips: number, vertical: boolean,
              priority: boolean, height: number, max_seconds: number, long_clips = false) =>
  ({ id, title, price_usd, channels, clips_per_stream: clips, vertical, priority, height, max_seconds, long_clips });

const PLANS = [
  plan("trial", L("Пробный, 3 дня", "Trial, 3 days"), 0, 1, 5, false, false, 720, 30),
  plan("standard", "Standard", 10, 3, 20, true, false, 720, 60),
  plan("pro", "Pro", 20, 5, 50, true, true, 1080, 90),
  plan("max", "Max", 50, 10, 100, true, true, 1440, 120, true),
];

const ch = (platform: string, name: string, title: string, live: boolean, clips_recent: number) => ({
  key: `${platform}:${name.toLowerCase()}`, platform, platform_title: title, name, url: `https://${platform}.tv/${name}`,
  live, clips_recent, my_clips_stream: live ? clips_recent : 0, avatar: null, display: name.replace(/^@/, ""),
});

// пример распознанной речи стримера: [начало, конец, слово]
const WORDS: [number, number, string][] = [
  [3.2, 3.6, "смотри"], [3.6, 3.9, "что"], [3.9, 4.2, "он"], [4.3, 4.8, "сделал"], [5.0, 5.4, "со"],
  [5.4, 6.0, "скином"], [6.2, 6.9, "дефолтной"], [7.0, 7.6, "гранаты"], [8.0, 8.5, "это"], [8.5, 9.2, "нереально"],
];

let channels = [
  ch("twitch", "evelone2004", "Twitch", true, 7),
  ch("kick", "adinross", "Kick", false, 0),
  ch("youtube", "@IShowSpeed", "YouTube", true, 3),
];

const clip = (id: string, channel: string, platform: string, platform_title: string, title: string, reason: string,
              kind: string, ago: number, thumb: number) => ({
  id, channel, channel_key: `${platform}:${channel.toLowerCase()}`, platform, platform_title, title, reason, kind,
  rating: 0, fav: id === "d1", words: WORDS, created: now() - ago, duration: 12, source_duration: 12, moment: 7, quality: 1080,
  messages: ["xd_maks: ААААА", "kira: КАК ОН ЭТО СДЕЛАЛ", "pro100: клип клип клип"],
  video: "demo/clip.mp4", vertical: "demo/clip_9x16.mp4", thumb: `demo/thumb${thumb}.jpg`,
});

let clips = [
  clip("d1", "evelone2004", "twitch", "Twitch", L("Эйс через смоук на последних секундах", "Ace through the smoke in the last seconds"), "чат x6", "chat", 300, 1),
  clip("d2", "evelone2004", "twitch", "Twitch", L("Чат не поверил, что это сработало", "Chat could not believe it worked"), "звук +9 dB", "audio", 1500, 2),
  clip("d3", "IShowSpeed", "youtube", "YouTube", L("Крик на весь стадион", "Screaming across the stadium"), "чат x4", "chat", 3600, 3),
  clip("d4", "evelone2004", "twitch", "Twitch", L("Зрители сами начали клипать", "Viewers started clipping themselves"), "клипы зрителей x3", "viewers", 7200, 1),
];

const me = () => ({
  id: 1, email: null, name: "Demo", provider: "demo", plan: PLANS[2], plan_until: now() + 25 * 86400,
  telegram_linked: true, telegram_username: "demo", bot_username: "HypeCut_bot", channels,
  usage: { channels: channels.length, clips_today: 9, clips_month: 37, my_clips_month: made, clips_total: 52 },
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let made = 0;

export async function demoCall(method: string, path: string, body: any): Promise<any> {
  await wait(250); // как будто сходили на сервер
  const [p] = path.split("?");
  if (p.startsWith("/auth/")) return { token: "demo", user: me() };
  if (p === "/me") return me();
  if (p === "/plans") return PLANS;
  if (p === "/clips") return clips;
  if (p === "/channels" && method === "POST") {
    const name = String(body.channel).replace(/^https?:\/\/[^/]+\//, "").replace(/\/.*/, "");
    if (channels.length >= 6) throw Object.assign(new Error(L("На этом тарифе больше каналов нельзя", "Your plan does not allow more channels")), { status: 403 });
    channels = [...channels, ch(body.platform ?? "twitch", name, "Twitch", false, 0)];
    return channels;
  }
  if (p.startsWith("/channels/") && method === "DELETE") {
    const key = decodeURIComponent(p.slice("/channels/".length));
    channels = channels.filter((x) => x.key !== key);
    return channels;
  }
  if (p === "/channels") return channels;
  if (p === "/popular" || p === "/search")
    return ["buster", "mokrivskyi", "exileshow", "kaicenat", "ibai"].map((n) => ({
      platform: "twitch", name: n, key: `twitch:${n}`, platform_title: "Twitch", display: n, live: Math.random() > 0.5, avatar: null,
    }));
  if (p.startsWith("/live/") && p.endsWith("/clip")) {
    await wait(1500);
    const key = decodeURIComponent(p.split("/")[2]);
    const c = channels.find((x) => x.key === key);
    made += 1;
    const x = { ...clip(`u${made}`, c?.name.replace(/^@/, "") ?? "stream", c?.platform ?? "twitch", c?.platform_title ?? "Twitch",
                       L("Мой момент", "My moment") + ` #${made}`, "твой клип", "user", 0, 2), duration: 12, source_duration: 12,
               moment: 9 };
    clips = [x, ...clips];
    return x;
  }
  if (p.endsWith("/fav")) {
    const id = decodeURIComponent(p.split("/")[2]);
    clips = clips.map((x) => (x.id === id ? { ...x, fav: body.on } : x));
    return { ok: true };
  }
  if (p.startsWith("/live/")) return { live: true, max_seconds: 90, playlist: "demo/stream.mp4", url: "https://twitch.tv" };
  if (p.endsWith("/edit") || p === "/highlights") {
    await wait(1800);
    return { id: "demo", video: body?.vertical === false ? "demo/clip.mp4" : "demo/clip_9x16.mp4", duration: 12 };
  }
  return { ok: true, url: "https://t.me/HypeCut_bot", app_url: "https://t.me/HypeCut_bot" };
}
