// Демо-режим: приложение работает без сервера, на примерах. Включается в веб-версии
// или переменной EXPO_PUBLIC_DEMO=1. Видео лежат рядом со страницей в папке demo/.
import { L } from "./i18n";

const now = () => Date.now() / 1000;
// Тарифы — один конфиг. Приложение рисует карточки только из этих данных, поэтому цены, часы и
// возможности можно менять здесь (на сервере — в plans.py), не переделывая интерфейс. Цены предварительные.
type P = { id: string; title: string; price_usd: number | null; founder_usd: number | null; hours: number | null; ai_clips: number | null;
           channels: number; height: number; watermark: boolean; priority: boolean; features: string[]; best?: boolean; contact?: boolean };
const plan = (x: P) => ({ clips_per_stream: x.ai_clips, vertical: true, long_clips: x.id !== "free", max_seconds: x.id === "free" ? 60 : 120, ...x });
const PLANS = [
  plan({ id: "free", title: "Free", price_usd: 0, founder_usd: null, hours: 2, ai_clips: 5, channels: 1, height: 720, watermark: true, priority: false,
         features: [L("Базовый редактор и субтитры", "Basic editor and captions"), L("Водяной знак HypeCut", "HypeCut watermark"), L("Экспорт до 720p", "Export up to 720p")] }),
  plan({ id: "creator", title: "Creator", price_usd: 17.99, founder_usd: 11.99, hours: 20, ai_clips: 100, channels: 3, height: 1080, watermark: false, priority: false,
         features: [L("Без водяного знака", "No watermark"), L("Экспорт 1080p", "1080p export"), L("Шаблоны и субтитры", "Templates and captions"), L("Доступ к редактору", "Full editor")] }),
  plan({ id: "pro", title: "Pro", price_usd: 34.99, founder_usd: 23.99, hours: 60, ai_clips: 300, channels: 3, height: 1080, watermark: false, priority: true, best: true,
         features: [L("Приоритетная обработка", "Priority processing"), L("Расширенные AI-функции", "Advanced AI features"), L("Несколько брендированных шаблонов", "Several branded templates"), L("Аналитика", "Analytics")] }),
  plan({ id: "agency", title: "Agency", price_usd: 119, founder_usd: 82.99, hours: 200, ai_clips: 1000, channels: 5, height: 1080, watermark: false, priority: true,
         features: [L("До 5 каналов", "Up to 5 channels"), L("Несколько пользователей", "Multiple users"), L("Совместная работа", "Collaboration"), L("Брендированные шаблоны и отчёты", "Branded templates and reports")] }),
  plan({ id: "business", title: "Business", price_usd: null, founder_usd: null, hours: null, ai_clips: null, channels: 20, height: 1080, watermark: false, priority: true, contact: true,
         features: [L("Большие объёмы обработки", "High processing volumes"), "Zoom, Google Meet, Microsoft Teams", L("Обработка конференций и мероприятий", "Conference and event processing"),
                    L("Командный доступ", "Team access"), L("Индивидуальные условия", "Custom terms")] }),
];
const PRICING = () => ({
  preliminary: true, kzt_per_usd: 520, yearly_discount: null,
  founder: { active: true, note: L("Специальные цены для первых клиентов. Цена сохраняется, пока подписка активна.", "Special prices for early customers. Kept while your subscription stays active.") },
  plans: PLANS,
  addons: [{ id: "h10", hours: 10, price_usd: 5.99 }, { id: "h30", hours: 30, price_usd: 13.99 }, { id: "h100", hours: 100, price_usd: 34.99 }],
  events: [
    { id: "small", title: "Small", from_usd: 99, note: L("Митап или воркшоп", "Meetup or workshop") },
    { id: "business", title: "Business", from_usd: 299, note: L("Конференция на один день", "One-day conference") },
    { id: "professional", title: "Professional", from_usd: 599, note: L("Несколько залов или дней", "Several stages or days") },
    { id: "enterprise", title: "Enterprise", from_usd: null, note: L("Крупный форум или серия событий", "Large forum or event series") },
  ],
});
let myPlan = "creator";
let hoursUsed = 16.5, hoursExtra = 0;

const ch = (platform: string, name: string, title: string, live: boolean, clips_recent: number) => ({
  key: `${platform}:${name.toLowerCase()}`, platform, platform_title: title, name, url: `https://${platform}.tv/${name}`,
  live, clips_recent, my_clips_stream: live ? clips_recent : 0, avatar: null, display: name.replace(/^@/, ""),
  viewers: live ? (name.startsWith("@") ? 48210 : 12450) : null, live_since: live ? now() - (name.startsWith("@") ? 3900 : 9240) : null,
  title: live ? (name.startsWith("@") ? "IRL Brazil" : "FACEIT до 4000 эло") : null, game: live ? (name.startsWith("@") ? "IRL" : "Counter-Strike 2") : null,
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
              kind: string, ago: number, thumb: number, status = "pending", score = 80, viewer_clips = 0) => ({
  status, score, viewer_clips, cam: { x: 0.015, y: 0.51, w: 0.225, h: 0.27 },
  id, channel, channel_key: `${platform}:${channel.toLowerCase()}`, platform, platform_title, title, reason, kind,
  rating: 0, fav: id === "d1", words: WORDS, created: now() - ago, duration: 12, source_duration: 12, moment: 7, quality: 1080,
  messages: ["xd_maks: ААААА", "kira: КАК ОН ЭТО СДЕЛАЛ", "pro100: клип клип клип"],
  video: "demo/clip.mp4", vertical: "demo/clip_9x16.mp4", thumb: `demo/thumb${thumb}.jpg`, strip: "demo/strip.jpg", strip_frames: 12,
  stream_at: 9000 - ago, // с какой секунды эфира начинается клип
});

let clips: any[] = [
  clip("d1", "evelone2004", "twitch", "Twitch", L("Эйс через смоук на последних секундах", "Ace through the smoke in the last seconds"), "чат x6", "chat", 300, 1, "pending", 92, 8),
  clip("d2", "evelone2004", "twitch", "Twitch", L("Чат не поверил, что это сработало", "Chat could not believe it worked"), "звук +9 dB", "audio", 1500, 2, "pending", 81, 3),
  clip("d3", "IShowSpeed", "youtube", "YouTube", L("Крик на весь стадион", "Screaming across the stadium"), "чат x4", "chat", 3600, 3, "approved", 88, 5),
  clip("d4", "evelone2004", "twitch", "Twitch", L("Зрители сами начали клипать", "Viewers started clipping themselves"), "клипы зрителей x3", "viewers", 7200, 1, "approved", 76, 12),
  clip("d5", "evelone2004", "twitch", "Twitch", L("Клатч 1 против 3", "1v3 clutch"), "чат x5", "chat", 4300, 2, "approved", 85, 4),
  clip("d6", "evelone2004", "twitch", "Twitch", L("Смех на весь эфир", "Laughing for the whole stream"), "звук +7 dB", "audio", 5100, 3, "pending", 64, 1),
  clip("d7", "evelone2004", "twitch", "Twitch", L("Донат на 10 000", "A 10,000 donation"), "чат x3", "chat", 6000, 1, "rejected", 58, 0),
];

const me = () => ({
  id: 1, email: null, name: "Demo", provider: "demo", plan: PLANS.find((x) => x.id === myPlan), plan_until: now() + 25 * 86400,
  telegram_linked: true, telegram_username: "demo", bot_username: "HypeCut_bot", channels,
  usage: { channels: channels.length, clips_today: 9, clips_month: 37, my_clips_month: made, clips_total: 52, hours_used: hoursUsed, hours_extra: hoursExtra, ai_clips_used: 74 },
});

// лента: посты других людей и свои
const post = (id: string, name: string, caption: string, channel: string | null, platform: string | null, likes: number, comments: number, ago: number, vertical = true) => ({
  id, video: vertical ? "demo/clip_9x16.mp4" : "demo/clip.mp4", thumb: "demo/thumb1.jpg", caption, channel, platform,
  author: { id: name, name, avatar: null, followed: name === "clipgod" }, likes, liked: false, comments, shares: Math.round(likes / 20), created: now() - ago,
});
let posts: any[] = [
  post("p1", "clipgod", "Эйс через смоук 😱 #cs2 #evelone", "evelone2004", "twitch", 12840, 214, 3600),
  post("p2", "aru.clips", "Чат не поверил 💀 #стрим", "evelone2004", "twitch", 5320, 96, 7200, false),
  post("p3", "speedfan", "КРИК НА ВЕСЬ СТАДИОН #ishowspeed", "IShowSpeed", "youtube", 48210, 1302, 20000),
  post("p4", "nurik_edits", "Зрители сами начали клипать 🔥", "evelone2004", "twitch", 2210, 41, 50000),
];
const COMMENTS = ["ахахах лучший момент", "это нереально 🔥", "в каком это стриме?", "клип года", "чат в шоке был", "ещё такие давай"];


// ── Длинные видео: файл, ссылка, встреча, конференция. Демо-сервер «разбирает» видео ~18 секунд
// и кладёт найденные моменты в общую очередь, как настоящий AI-движок.
const STEPS: [string, number][] = [["ingest", 3], ["transcribe", 7], ["speakers", 9], ["analyze", 12], ["detect", 14], ["generate", 17]];
const TOTAL = 17;
type M = [string, string, string, string, string[], number, number]; // заголовок, цитата, спикер, эмоция, сигналы, оценка, секунда видео
const MOMENTS: Record<string, M[]> = {
  podcast: [
    [L("«Время дороже денег» — главный совет гостя", "“Time beats money” — the guest's main advice"), L("Деньги можно заработать снова, а время — нет", "You can earn money again, but not time"), L("Гость", "Guest"), L("уверенность", "confidence"), [L("цитата", "quote"), L("ключевая мысль", "key idea")], 94, 1265],
    [L("Ведущий не ожидал такого ответа", "The host did not expect that answer"), L("Подожди, ты серьёзно так сделал?", "Wait, you really did that?"), L("Ведущий", "Host"), L("удивление", "surprise"), [L("смена спикера", "speaker change"), L("эмоция", "emotion")], 88, 2140],
    [L("Смех на всю студию", "Laughter fills the studio"), L("Я тогда вообще ничего не понял", "I understood nothing back then"), L("Гость", "Guest"), L("смех", "laughter"), [L("смех", "laughter"), L("громкость", "loudness")], 83, 845],
    [L("Совет новичкам за 30 секунд", "Advice for beginners in 30 seconds"), L("Начни с одного дела и доведи его до конца", "Start with one thing and finish it"), L("Гость", "Guest"), L("спокойствие", "calm"), [L("ключевая мысль", "key idea")], 79, 3010],
  ],
  lecture: [
    [L("Главная мысль лекции за минуту", "The lecture's main idea in a minute"), L("Если вы запомните только одно — запомните это", "If you remember one thing, remember this"), L("Лектор", "Lecturer"), L("воодушевление", "enthusiasm"), [L("ключевая мысль", "key idea"), L("цитата", "quote")], 92, 1580],
    [L("Лучший вопрос из зала", "The best question from the audience"), L("А что делать, если не получилось с первого раза?", "What if it doesn't work the first time?"), L("Слушатель", "Listener"), L("интерес", "interest"), [L("вопрос-ответ", "Q&A"), L("смена спикера", "speaker change")], 86, 2930],
    [L("Пример, который всё объясняет", "The example that explains everything"), L("Представьте, что вы открываете кофейню", "Imagine you are opening a coffee shop"), L("Лектор", "Lecturer"), L("интерес", "interest"), [L("ключевая мысль", "key idea")], 77, 960],
  ],
  meeting: [
    [L("Решение: запускаемся в феврале", "Decision: we launch in February"), L("Хорошо, тогда фиксируем запуск на февраль", "OK, let's lock the launch for February"), "Айдана", L("уверенность", "confidence"), [L("решение", "decision"), L("ключевая мысль", "key idea")], 93, 1710],
    [L("Важный вопрос клиента о цене", "The client's key question about price"), L("Сколько это будет стоить на сто человек?", "How much for a hundred people?"), "Тимур", L("интерес", "interest"), [L("вопрос", "question"), L("смена спикера", "speaker change")], 85, 640],
    [L("Итоги встречи за минуту", "Meeting summary in a minute"), L("Итак, три задачи на эту неделю", "So, three tasks for this week"), "Айдана", L("спокойствие", "calm"), [L("итог", "summary")], 81, 2480],
  ],
  event: [
    [L("Сильная цитата со сцены", "A strong quote from the stage"), L("Будущее строят те, кто не ждёт разрешения", "The future is built by those who don't wait for permission"), L("Спикер", "Speaker"), L("воодушевление", "enthusiasm"), [L("цитата", "quote"), L("аплодисменты", "applause")], 95, 2210],
    [L("Зал встал и аплодировал", "Standing ovation"), L("Спасибо, Алматы!", "Thank you, Almaty!"), L("Спикер", "Speaker"), L("восторг", "delight"), [L("аплодисменты", "applause"), L("громкость", "loudness")], 90, 3480],
    [L("Неожиданный анонс", "A surprise announcement"), L("И ещё одно: мы открываем офис в Астане", "One more thing: we are opening an office in Astana"), L("Спикер", "Speaker"), L("удивление", "surprise"), [L("ключевая мысль", "key idea"), L("реакция зала", "audience reaction")], 87, 1320],
  ],
  stream: [
    [L("Клатч, после которого чат взорвался", "The clutch that made chat explode"), L("НЕТ, НЕТ, ДА-А-А!", "NO, NO, YES!"), L("Стример", "Streamer"), L("восторг", "delight"), [L("эмоция", "emotion"), L("громкость", "loudness")], 91, 4120],
    [L("Смешной провал в начале", "A funny fail at the start"), L("Я просто нажал не ту кнопку", "I just pressed the wrong button"), L("Стример", "Streamer"), L("смех", "laughter"), [L("смех", "laughter")], 80, 610],
  ],
};
MOMENTS.interview = MOMENTS.podcast;
MOMENTS.webinar = MOMENTS.lecture;
const SPEAKERS: Record<string, string[]> = {
  podcast: [L("Ведущий", "Host"), L("Гость", "Guest")], interview: [L("Ведущий", "Host"), L("Гость", "Guest")],
  lecture: [L("Лектор", "Lecturer"), L("Слушатель", "Listener")], webinar: [L("Лектор", "Lecturer"), L("Слушатель", "Listener")],
  meeting: ["Айдана", "Тимур", "Ержан"], event: [L("Спикер", "Speaker"), L("Ведущий", "Host")], stream: [L("Стример", "Streamer")],
};
const PLATFORM_TITLE: Record<string, string> = {
  file: L("Видео", "Video"), youtube: "YouTube", vimeo: "Vimeo", link: L("Ссылка", "Link"), zoom: "Zoom", meet: "Google Meet", teams: "Microsoft Teams",
};
const auto = (kind: string) => (kind === "meeting" ? "meeting" : kind === "event" ? "event" : "podcast");

let sources: any[] = [];
let delivered = new Set<string>();
let integrations = [
  { id: "zoom", title: "Zoom", connected: false, account: null as string | null },
  { id: "meet", title: "Google Meet", connected: false, account: null as string | null },
  { id: "teams", title: "Microsoft Teams", connected: false, account: null as string | null },
];
const RECORDINGS: Record<string, any[]> = {
  zoom: [["z1", L("Планёрка команды продаж", "Sales team sync"), 2940, 1, 6], ["z2", L("Вебинар: как начать стримить", "Webinar: how to start streaming"), 4320, 3, 128], ["z3", L("Созвон с клиентом", "Client call"), 1860, 6, 3]],
  meet: [["g1", L("Еженедельная встреча", "Weekly meeting"), 2400, 2, 8], ["g2", L("Интервью с кандидатом", "Candidate interview"), 2700, 5, 2]],
  teams: [["t1", L("Обучение новых сотрудников", "New hire training"), 5400, 1, 24], ["t2", L("Квартальный отчёт", "Quarterly report"), 3600, 4, 40]],
};

function stepOf(x: any) {
  const t = now() - x.created;
  if (t >= TOTAL) return { status: "done", progress: 1 };
  const st = STEPS.find(([, end]) => t < end)!;
  return { status: st[0], progress: t / TOTAL };
}
function view(x: any) {
  const st = stepOf(x);
  const sc = x.scenario === "auto" ? auto(x.kind) : x.scenario;
  const ms = MOMENTS[sc] ?? MOMENTS.podcast;
  if (st.status === "done" && !delivered.has(x.id)) {
    delivered.add(x.id);
    const made = ms.map(([title, quote, speaker, emotion, signals, score, at], i) => ({
      ...clip(`${x.id}_${i}`, x.title, x.platform, PLATFORM_TITLE[x.platform] ?? x.platform, title, signals.join(" · "), "ai", -i, 1 + (i % 3), "pending", score, 0),
      channel_key: `src:${x.id}`, stream_at: at, source_id: x.id, source_kind: x.kind, scenario: sc, speaker, quote, emotion, signals, cam: null, messages: [],
      words: quote.split(" ").map((w: string, j: number) => [2 + j * 0.45, 2.4 + j * 0.45, w]),
    }));
    clips = [...made, ...clips];
  }
  return { ...x, ...st, scenario: x.scenario, clips: st.status === "done" ? ms.length : 0,
           speakers: ["speakers", "analyze", "detect", "generate", "done"].includes(st.status) ? (SPEAKERS[sc] ?? []) : [] };
}
function createSource(b: any) {
  const id = `s${sources.length + 1}_${Math.floor(now()) % 10000}`;
  const host = b.url ? String(b.url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "";
  const platform = b.platform ?? (b.kind === "upload" ? "file" : /youtu/.test(host) ? "youtube" : /vimeo/.test(host) ? "vimeo" : "link");
  const rec = b.recording ? Object.values(RECORDINGS).flat().find((r) => r[0] === b.recording) : null;
  const title = b.title || (rec ? rec[1] : b.kind === "url" ? (platform === "youtube" ? L("Видео с YouTube", "YouTube video") : host || L("Видео по ссылке", "Linked video")) : L("Моё видео", "My video"));
  const x = { id, kind: b.kind, platform, title, ref: b.url ?? b.upload ?? b.recording ?? "", scenario: b.scenario ?? "auto",
              duration: rec ? rec[2] : 3600 + Math.floor(Math.random() * 1800), created: now(), thumb: "demo/thumb2.jpg", error: null };
  sources = [x, ...sources];
  hoursUsed = Math.round((hoursUsed + x.duration / 3600) * 10) / 10;
  return view(x);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let made = 0;

export async function demoCall(method: string, path: string, body: any): Promise<any> {
  await wait(250); // как будто сходили на сервер
  const [p] = path.split("?");
  if (p.startsWith("/auth/")) return { token: "demo", user: me() };
  if (p === "/me") return me();
  if (p === "/plans") return PLANS;
  if (p === "/pricing") return PRICING();
  if (p === "/streamers/request") {
    if (!/^(https?:\/\/)?(www\.)?(twitch\.tv|youtube\.com|kick\.com|tiktok\.com|live\.vkvideo\.ru)\/\S+|^@?[\w.]{3,}$/i.test(String(body.channel).trim()))
      throw Object.assign(new Error(L("Не похоже на канал. Пример: twitch.tv/имя или youtube.com/@имя", "That does not look like a channel")), { status: 400 });
    return { ok: true, channel: body.channel };
  }
  if (p === "/billing/plan") { await wait(600); myPlan = body.id; hoursUsed = Math.min(hoursUsed, 2); return { ok: true, url: null }; }
  if (p === "/billing/hours") {
    await wait(600);
    hoursExtra += PRICING().addons.find((x) => x.id === body.id)?.hours ?? 0;
    return { ok: true, url: null };
  }
  if (p === "/clips") { sources.forEach(view); return clips; }
  if (p === "/sources" && method === "GET") return sources.map(view);
  if (p === "/sources" && method === "POST") {
    if (body.kind === "url" && !/^https?:\/\/\S+\.\S+/.test(String(body.url ?? "")))
      throw Object.assign(new Error(L("Это не похоже на ссылку на видео", "This does not look like a video link")), { status: 400 });
    const lim = (PLANS.find((x) => x.id === myPlan)?.hours ?? 1e9) + hoursExtra;
    if (hoursUsed >= lim) throw Object.assign(new Error(L("Часы обработки закончились. Докупи часы в «Тарифах».", "Out of processing hours. Buy more in Plans.")), { status: 402 });
    return createSource(body);
  }
  if (p.startsWith("/sources/") && method === "DELETE") {
    const id = p.split("/")[2];
    sources = sources.filter((x) => x.id !== id);
    return { ok: true };
  }
  if (p === "/integrations") return integrations;
  if (p.startsWith("/integrations/") && p.endsWith("/connect")) {
    const id = p.split("/")[2];
    await wait(900);
    integrations = integrations.map((x) => (x.id === id ? { ...x, connected: true, account: "demo@hypecut.app" } : x));
    return { url: null, connected: true };
  }
  if (p.startsWith("/integrations/") && p.endsWith("/recordings"))
    return (RECORDINGS[p.split("/")[2]] ?? []).map(([id, title, duration, days, participants]) => ({ id, title, duration, date: now() - days * 86400, participants }));
  if (p.startsWith("/integrations/") && method === "DELETE") {
    const id = p.split("/")[2];
    integrations = integrations.map((x) => (x.id === id ? { ...x, connected: false, account: null } : x));
    return { ok: true };
  }
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
  if (p.endsWith("/review")) {
    const id = decodeURIComponent(p.split("/")[2]);
    clips = clips.map((x) => (x.id === id ? { ...x, status: body.status } : x));
    return { ok: true };
  }
  if (p === "/clippers")
    return [["kira_clips", 41, 33, 182000], ["xd_maks", 35, 24, 96400], ["clipgod", 28, 25, 412000], ["aru.clips", 19, 12, 51200], ["pro100", 14, 9, 23800],
            ["nurik_edits", 9, 7, 18100]].map(([name, c, a, v]) => ({ name, clips: c, approved: a, views: v, platform: "twitch" }));
  if (p.endsWith("/fav")) {
    const id = decodeURIComponent(p.split("/")[2]);
    clips = clips.map((x) => (x.id === id ? { ...x, fav: body.on } : x));
    return { ok: true };
  }
  if (p.startsWith("/live/")) return { live: true, max_seconds: 90, playlist: "demo/stream.mp4", url: "https://twitch.tv" };
  if (p === "/feed" && method === "GET") {
    const kind = path.includes("kind=following") ? "following" : path.includes("kind=mine") ? "mine" : "foryou";
    return kind === "mine" ? posts.filter((x) => x.mine) : kind === "following" ? posts.filter((x) => x.author.followed) : posts;
  }
  if (p === "/feed" && method === "POST") {
    const x = { ...post(`m${posts.length}`, "demo", body.caption || "", body.own ? null : body.credit, body.own ? null : "twitch", 0, 0, 0),
                video: body.video, mine: true, own: !!body.own, credit: body.credit ?? null };
    posts = [x, ...posts];
    return x;
  }
  if (p.startsWith("/feed/") && p.endsWith("/report")) {
    if (body.reason === "rights") posts = posts.filter((x) => x.id !== p.split("/")[2]);
    return { ok: true };
  }
  if (p.startsWith("/feed/") && p.endsWith("/like")) {
    const id = p.split("/")[2];
    posts = posts.map((x) => (x.id === id ? { ...x, liked: body.on, likes: x.likes + (body.on ? 1 : -1) } : x));
    return { ok: true };
  }
  if (p.startsWith("/authors/")) {
    const a = p.split("/")[2];
    posts = posts.map((x) => (x.author.id === a ? { ...x, author: { ...x.author, followed: body.on } } : x));
    return { ok: true };
  }
  if (p.endsWith("/comments") && method === "GET")
    return COMMENTS.map((text, i) => ({ id: `c${i}`, author: ["kira", "xd_maks", "pro100", "aidana", "timur", "zhan"][i], text, created: now() - i * 900, likes: 40 - i * 6 }));
  if (p.endsWith("/comments")) return { id: `c${Date.now()}`, author: "demo", text: body.text, created: now(), likes: 0 };
  if (p.endsWith("/edit") || p === "/highlights") {
    await wait(1800);
    return { id: "demo", video: body?.vertical === false ? "demo/clip.mp4" : "demo/clip_9x16.mp4", duration: 12 };
  }
  return { ok: true, url: "https://t.me/HypeCut_bot", app_url: "https://t.me/HypeCut_bot" };
}
