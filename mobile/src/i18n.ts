import { getLocales } from "expo-localization";
import { KK } from "./kk";

// Три языка: казахский, русский, английский. По умолчанию как в телефоне:
// казахский телефон открывает приложение на казахском, русский и СНГ на русском, остальные на английском.
export type Lang = "kk" | "ru" | "en";
const RU_LANGS = ["ru", "uk", "be", "uz", "ky", "tg", "hy", "az"];

export function phoneLang(): Lang {
  try {
    const code = getLocales()[0]?.languageCode ?? "";
    if (code === "kk") return "kk";
    return RU_LANGS.includes(code) ? "ru" : "en";
  } catch {
    return "ru";
  }
}

let lang: Lang = phoneLang();

export const getLang = (): Lang => lang;
export function setLang(l: Lang | "auto") {
  lang = l === "auto" ? phoneLang() : l;
}
/** Для дат и времени */
export const locale = () => ({ kk: "kk-KZ", ru: "ru-RU", en: "en-US" })[lang];

/**
 * Текст на выбранном языке: L("Привет", "Hello").
 * Казахский берётся из словаря kk.ts по русскому тексту; для текста с подстановками третьим аргументом.
 * Если перевода нет, показываем русский: казахстанцы его понимают лучше английского.
 */
export const L = (ru: string, en: string, kk?: string) =>
  lang === "en" ? en : lang === "kk" ? (kk ?? KK[ru] ?? ru) : ru;
