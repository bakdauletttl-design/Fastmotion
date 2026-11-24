import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_URL } from "./config";
import { demoCall } from "./demo";
import { getLang, L } from "./i18n";

// Тариф целиком приходит с сервера (один конфиг): цены, лимиты и список возможностей можно менять,
// не трогая приложение. Цены пока предварительные.
export type Plan = {
  id: string; // free, creator, pro, agency, business (старые: trial, standard, max)
  title: string;
  price_usd: number | null; // null = индивидуальная цена
  founder_usd?: number | null; // цена для первых клиентов (Founder Pricing)
  hours?: number | null; // часов обработки видео в месяц
  ai_clips?: number | null; // AI-клипов в месяц
  watermark?: boolean;
  features?: string[]; // что написать в карточке тарифа
  best?: boolean;
  contact?: boolean; // «Связаться с нами» вместо покупки
  channels: number;
  clips_per_stream: number | null;
  vertical: boolean;
  priority: boolean;
  height: number;
  long_clips: boolean;
  max_seconds: number; // самый длинный клип для кнопки «Клип» и монтажа
};

export type Usage = {
  channels: number; clips_today: number; clips_month: number; my_clips_month: number; clips_total: number;
  hours_used?: number; // часов обработки потрачено в этом месяце
  hours_extra?: number; // докупленные часы (не сгорают в конце месяца)
  ai_clips_used?: number;
};
/** Всё для страницы тарифов одним запросом: тарифы, пакеты часов, разовая обработка мероприятий. */
export type Pricing = {
  preliminary: boolean; // цены предварительные: показываем пометку
  kzt_per_usd: number; // курс для цены в тенге
  yearly_discount: number | null; // скидка за год, пока не решено
  founder: { active: boolean; note: string } | null;
  plans: Plan[];
  addons: { id: string; hours: number; price_usd: number }[];
  events: { id: string; title: string; from_usd: number | null; note: string }[];
};
export type Word = [number, number, string];

export type PlatformId = "twitch" | "youtube" | "kick" | "vk" | "tiktok";

export type Channel = {
  key: string; // «площадка:имя», например twitch:nightowl
  platform: PlatformId;
  platform_title: string;
  name: string;
  url: string;
  live: boolean;
  clips_recent: number;
  my_clips_stream?: number; // сколько клипов этого эфира уже пришло тебе
  avatar?: string | null;
  display?: string;
  viewers?: number | null; // зрителей сейчас
  live_since?: number | null; // когда начался эфир (unix)
  title?: string | null; game?: string | null;
};

export type Found = {
  platform: PlatformId;
  name: string;
  title?: string;
  display?: string;
  avatar?: string | null;
  live?: boolean;
  game?: string | null;
  key?: string;
  platform_title?: string;
};

export type Me = {
  id: number;
  email: string | null;
  name: string | null;
  provider: string;
  plan: Plan | null;
  plan_until: number | null;
  telegram_linked: boolean;
  telegram_username: string | null;
  bot_username: string;
  channels: Channel[];
  usage?: Usage;
};

export type Clip = {
  id: string;
  channel: string;
  channel_key: string;
  platform: PlatformId;
  platform_title: string;
  moment: number | null;
  messages: string[];
  reason: string;
  title: string | null;
  rating: number;
  fav?: boolean;
  words?: Word[];
  kind: string;
  created: number;
  duration: number;
  source_duration?: number; // длина исходника: столько можно обрезать в редакторе
  quality: number;
  video: string;
  thumb: string | null;
  strip?: string | null; // кадры клипа одной полоской для ленты монтажа и перемотки на превью
  strip_frames?: number; // сколько кадров в полоске
  stream_at?: number | null; // с какой секунды эфира начинается клип (время стрима)
  vertical: string | null;
  status?: "pending" | "approved" | "rejected"; // очередь утверждения: стример принимает или отклоняет найденное
  score?: number; // насколько ярко, 0..100
  viewer_clips?: number; // сколько зрителей написали !clip
  cam?: { x: number; y: number; w: number; h: number } | null; // где на стриме вебка (сервер находит лицо), доли кадра
  // что нашёл AI-движок (у клипов со стримов может быть пусто)
  source_id?: string | null; // из какого длинного видео клип
  source_kind?: SourceKind | null;
  scenario?: Scenario | null;
  speaker?: string | null; // кто говорит в моменте
  quote?: string | null; // сильная фраза, ради которой клип
  emotion?: string | null; // смех, удивление, злость, восторг…
  signals?: string[]; // почему AI выбрал момент: «цитата», «смена спикера», «смех зала»…
};

/** Откуда берём длинное видео. У каждого вида свой адаптер на сервере, дальше всё общее. */
export type SourceKind = "live" | "upload" | "url" | "meeting" | "event";
/** Что искать в видео: от этого зависят веса сигналов и подсказка нейросети. */
export type Scenario = "auto" | "stream" | "podcast" | "interview" | "lecture" | "meeting" | "webinar" | "event";
export type SourceStep = "queued" | "ingest" | "transcribe" | "speakers" | "analyze" | "detect" | "generate" | "done" | "failed";
/** Длинное видео, которое HypeCut разбирает на клипы. */
export type Source = {
  id: string;
  kind: SourceKind;
  platform: string | null; // youtube, zoom, meet, teams, file…
  title: string;
  ref: string; // ссылка или имя файла
  scenario: Scenario;
  status: SourceStep;
  progress: number; // 0..1 всего пути
  duration: number | null; // длина видео, секунды
  created: number;
  clips: number; // сколько моментов нашлось
  speakers: string[]; // кого распознал движок
  thumb: string | null;
  error: string | null;
};
export type NewSource = { kind: SourceKind; scenario: Scenario; platform?: string; title?: string; url?: string; upload?: string; recording?: string; rights?: boolean };
/** Подключённые сервисы встреч: Zoom, Google Meet, Microsoft Teams. */
export type Integration = { id: "zoom" | "meet" | "teams"; title: string; connected: boolean; account: string | null; available?: boolean };
export type Recording = { id: string; title: string; duration: number; date: number; participants: number };
/** Кто чаще всех находит моменты: зрители с командой !clip и авторы ленты. */
export type Clipper = { name: string; clips: number; approved: number; views: number; platform?: PlatformId };

/** Пост в ленте HypeCut: клип, который человек выложил внутри приложения. */
export type Post = {
  id: string; video: string; thumb: string | null; caption: string;
  author: { id: string; name: string; avatar?: string | null; followed?: boolean };
  channel?: string | null; platform?: PlatformId | null; // чей стрим
  own?: boolean; credit?: string | null;                 // своё видео или чужое с разрешения: кто автор оригинала
  likes: number; liked?: boolean; comments: number; shares: number; created: number; mine?: boolean;
};
export type Comment = { id: string; author: string; text: string; created: number; likes: number };

const KEY = "hypecut_session";
/** Демо без сервера: веб-версия для показа или сборка с EXPO_PUBLIC_DEMO=1 */
export const DEMO = Platform.OS === "web" || process.env.EXPO_PUBLIC_DEMO === "1";
let token: string | null = null;

export async function loadToken(): Promise<string | null> {
  if (DEMO) return token;
  token = await SecureStore.getItemAsync(KEY);
  return token;
}

export async function setToken(t: string | null): Promise<void> {
  token = t;
  if (DEMO) return;
  if (t) await SecureStore.setItemAsync(KEY, t);
  else await SecureStore.deleteItemAsync(KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (DEMO) {
    try {
      return (await demoCall(method, path, body)) as T;
    } catch (e: any) {
      throw new ApiError(e?.status ?? 400, String(e?.message ?? e));
    }
  }
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": getLang(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.detail ?? L("Сервер не ответил", "Server did not respond"));
  return data as T;
}

type Session = { token: string; user: Me };

export type LiveInfo = { live: boolean; max_seconds: number; playlist: string | null; url: string };
export type Rendered = { id: string; video: string; duration: number };
export type Style = {
  font?: string; music?: string | null; music_volume?: number; overlay?: string | null; overlay_pos?: "top" | "corner";
  text_color?: string | null; word_color?: string | null; title_color?: string | null; // #RRGGBB
  // где стоит текст на видео: доли ширины и высоты кадра (центр текста), человек двигает его пальцем
  title_x?: number; title_y?: number; caption_x?: number; caption_y?: number;
  caption_preset?: string; stroke?: boolean; shadow?: boolean; upper?: boolean; anim?: "none" | "pop" | "fade" | "slide"; // вид субтитров
};
export type EditOptions = Style & { start: number; end: number; vertical: boolean; aspect?: string; quality?: number; extra?: unknown; subtitles: boolean; title?: string | null; words?: Word[] | null };
export type Part = { clip: string; start: number; end: number };

export const api = {
  loginGoogle: (id_token: string) => call<Session>("POST", "/auth/google", { id_token }),
  loginApple: (identity_token: string, name?: string) =>
    call<Session>("POST", "/auth/apple", { identity_token, name }),
  loginDev: (name: string) => call<Session>("POST", "/auth/dev", { name }),
  me: () => call<Me>("GET", "/me"),
  deleteMe: () => call<{ ok: boolean }>("DELETE", "/me"),
  telegramLink: () => call<{ url: string; app_url: string }>("POST", "/telegram/link"),
  addChannel: (channel: string, platform: PlatformId) =>
    call<Channel[]>("POST", "/channels", { channel, platform }),
  removeChannel: (key: string) => call<Channel[]>("DELETE", `/channels/${encodeURIComponent(key)}`),
  clips: () => call<Clip[]>("GET", "/clips"),
  plans: () => call<Plan[]>("GET", "/plans"),
  pricing: () => call<Pricing>("GET", "/pricing"),
  /** Выбрать тариф (на сайте и в боте оплата картой или Stars; в магазинах приложений — через RevenueCat). */
  choosePlan: (id: string, period: "month" | "year") => call<{ ok: boolean; url: string | null }>("POST", "/billing/plan", { id, period }),
  buyHours: (id: string) => call<{ ok: boolean; url: string | null }>("POST", "/billing/hours", { id }),
  /** Заявка: Business или разовая обработка мероприятия. */
  requestQuote: (kind: string, text: string) => call<{ ok: boolean }>("POST", "/billing/quote", { kind, text }),
  search: (q: string, platform: PlatformId) =>
    call<Found[]>("GET", `/search?q=${encodeURIComponent(q)}&platform=${platform}`),
  popular: () => call<Found[]>("GET", "/popular"),
  rate: (id: string, value: number) => call<{ ok: boolean }>("POST", `/clips/${encodeURIComponent(id)}/rate`, { value }),
  pushToken: (token: string) => call<{ ok: boolean }>("POST", "/push/token", { token }),
  // эфир в приложении и клип своими руками
  live: (key: string) => call<LiveInfo>("GET", `/live/${encodeURIComponent(key)}`),
  cut: (key: string, seconds: number, behind: number) =>
    call<Clip>("POST", `/live/${encodeURIComponent(key)}/clip`, { seconds, behind }),
  edit: (id: string, o: EditOptions) => call<Rendered>("POST", `/clips/${encodeURIComponent(id)}/edit`, o),
  sendClip: (id: string, edit?: string) =>
    call<{ ok: boolean }>("POST", `/clips/${encodeURIComponent(id)}/telegram`, { edit: edit ?? null }),
  highlights: (parts: Part[], vertical: boolean, subtitles: boolean, title?: string | null, style: Style & { transition?: string } = {}) =>
    call<Rendered>("POST", "/highlights", { parts, vertical, subtitles, title: title ?? null, ...style }),
  review: (id: string, status: "approved" | "rejected" | "pending") => call<{ ok: boolean }>("POST", `/clips/${encodeURIComponent(id)}/review`, { status }),
  clippers: () => call<Clipper[]>("GET", "/clippers"),
  fav: (id: string, on: boolean) => call<{ ok: boolean }>("POST", `/clips/${encodeURIComponent(id)}/fav`, { on }),
  /** Своя музыка или видео для монтажа: файл с телефона уходит на сервер как есть. */
  upload: async (kind: "audio" | "video" | "image" | "font" | "source", uri: string): Promise<{ id: string }> => {
    if (DEMO) return { id: `${kind}_demo00000000` };
    const blob = await (await fetch(uri)).blob();
    const res = await fetch(`${API_URL}/uploads?kind=${kind}`, {
      method: "POST", body: blob,
      headers: { "Accept-Language": getLang(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.detail ?? L("Сервер не ответил", "Server did not respond"));
    return data;
  },
  /** Пожелание: чего не хватает в приложении. Приходит нам. */
  feedback: (text: string) => call<{ ok: boolean }>("POST", "/feedback", { text }),
  /** Стример просит больше не нарезать его канал. */
  optOut: (channel: string, contact: string, text: string, owner: boolean) =>
    call<{ ok: boolean; channel: string }>("POST", "/streamers/request", { channel, contact, text, owner }),
  // лента внутри приложения, как в TikTok
  feed: (kind: "foryou" | "following" | "mine") => call<Post[]>("GET", `/feed?kind=${kind}`),
  publish: (video: string, caption: string, clip: string | null | undefined, rights: { own: boolean; credit: string | null }) =>
    call<Post>("POST", "/feed", { video, caption, clip: clip ?? null, ...rights }),
  report: (id: string, reason: string) => call<{ ok: boolean }>("POST", `/feed/${id}/report`, { reason }),
  like: (id: string, on: boolean) => call<{ ok: boolean }>("POST", `/feed/${id}/like`, { on }),
  follow: (author: string, on: boolean) => call<{ ok: boolean }>("POST", `/authors/${author}/follow`, { on }),
  comments: (id: string) => call<Comment[]>("GET", `/feed/${id}/comments`),
  comment: (id: string, text: string) => call<Comment>("POST", `/feed/${id}/comments`, { text }),
  // длинные видео: стрим, файл, ссылка, встреча. Сервер сам находит моменты и кладёт их в очередь
  sources: () => call<Source[]>("GET", "/sources"),
  createSource: (x: NewSource) => call<Source>("POST", "/sources", x),
  deleteSource: (id: string) => call<{ ok: boolean }>("DELETE", `/sources/${encodeURIComponent(id)}`),
  integrations: () => call<Integration[]>("GET", "/integrations"),
  /** Вход в Zoom / Google / Microsoft: сервер отдаёт ссылку на их страницу входа. */
  connect: (id: string) => call<{ url: string | null; connected: boolean }>("POST", `/integrations/${id}/connect`),
  disconnect: (id: string) => call<{ ok: boolean }>("DELETE", `/integrations/${id}`),
  recordings: (id: string) => call<Recording[]>("GET", `/integrations/${id}/recordings`),
  sendHighlights: (id: string) => call<{ ok: boolean }>("POST", `/highlights/${id}/telegram`),
};

// Файлы клипов открываются по ссылке, поэтому токен передаётся в адресе
export const withToken = (url: string) => (DEMO ? url : `${url}?token=${encodeURIComponent(token ?? "")}`);
