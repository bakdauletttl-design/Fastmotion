// Выбор человека: тема и язык. Хранится на телефоне (в браузере для демо).
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { Lang, setLang } from "./i18n";
import { applyTheme, ThemeId, THEMES } from "./ui";

export type Settings = { theme: ThemeId; lang: Lang | "auto" };
const KEY = "hypecut_settings";
let current: Settings = { theme: "emerald", lang: "auto" };

async function read(): Promise<string | null> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

async function write(v: string): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, v);
    else await SecureStore.setItemAsync(KEY, v);
  } catch {}
}

function apply(s: Settings) {
  current = s;
  applyTheme(THEMES[s.theme] ? s.theme : "emerald");
  setLang(s.lang);
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await read();
    if (raw) apply({ ...current, ...JSON.parse(raw) });
  } catch {}
  return current;
}

export const getSettings = () => current;

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  apply({ ...current, ...patch });
  await write(JSON.stringify(current));
  return current;
}
