import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_URL } from "./config";
import { demoCall } from "./demo";
import { L, LANG } from "./i18n";

export type Plan = {
  id: "trial" | "standard" | "pro" | "max";
  title: string;
  price_usd: number;
  channels: number;
  clips_per_stream: number | null;
  vertical: boolean;
  priority: boolean;
  height: number;
  long_clips: boolean;
  max_seconds: number; // самый длинный клип для кнопки «Клип» и монтажа
};

export type Usage = { channels: number; clips_today: number; clips_month: number; my_clips_month: number; clips_total: number };
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
  vertical: string | null;
};

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
      "Accept-Language": LANG,
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
export type Style = { font?: string; music?: string | null; music_volume?: number; overlay?: string | null; overlay_pos?: "top" | "corner" };
export type EditOptions = Style & { start: number; end: number; vertical: boolean; subtitles: boolean; title?: string | null; words?: Word[] | null };
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
  fav: (id: string, on: boolean) => call<{ ok: boolean }>("POST", `/clips/${encodeURIComponent(id)}/fav`, { on }),
  /** Своя музыка или видео для монтажа: файл с телефона уходит на сервер как есть. */
  upload: async (kind: "audio" | "video", uri: string): Promise<{ id: string }> => {
    if (DEMO) return { id: `${kind}_demo00000000` };
    const blob = await (await fetch(uri)).blob();
    const res = await fetch(`${API_URL}/uploads?kind=${kind}`, {
      method: "POST", body: blob,
      headers: { "Accept-Language": LANG, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.detail ?? L("Сервер не ответил", "Server did not respond"));
    return data;
  },
  sendHighlights: (id: string) => call<{ ok: boolean }>("POST", `/highlights/${id}/telegram`),
};

// Файлы клипов открываются по ссылке, поэтому токен передаётся в адресе
export const withToken = (url: string) => (DEMO ? url : `${url}?token=${encodeURIComponent(token ?? "")}`);
