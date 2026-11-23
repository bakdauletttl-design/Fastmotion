import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";
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
};

export type PlatformId = "twitch" | "youtube" | "kick" | "vk" | "tiktok";

export type Channel = {
  key: string; // «площадка:имя», например twitch:nightowl
  platform: PlatformId;
  platform_title: string;
  name: string;
  url: string;
  live: boolean;
  clips_recent: number;
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
let token: string | null = null;

export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(KEY);
  return token;
}

export async function setToken(t: string | null): Promise<void> {
  token = t;
  if (t) await SecureStore.setItemAsync(KEY, t);
  else await SecureStore.deleteItemAsync(KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
export type EditOptions = { start: number; end: number; vertical: boolean; subtitles: boolean; title?: string | null };
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
  highlights: (parts: Part[], vertical: boolean, subtitles: boolean, title?: string | null) =>
    call<Rendered>("POST", "/highlights", { parts, vertical, subtitles, title: title ?? null }),
  sendHighlights: (id: string) => call<{ ok: boolean }>("POST", `/highlights/${id}/telegram`),
};

// Файлы клипов открываются по ссылке, поэтому токен передаётся в адресе
export const withToken = (url: string) => `${url}?token=${encodeURIComponent(token ?? "")}`;
