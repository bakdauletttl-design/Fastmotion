import { getLocales } from "expo-localization";

// Русский для России и СНГ, английский для всех остальных
const RU_LANGS = ["ru", "uk", "be", "kk", "uz", "ky", "tg", "hy", "az"];

let lang: "ru" | "en" = "en";
try {
  lang = RU_LANGS.includes(getLocales()[0]?.languageCode ?? "") ? "ru" : "en";
} catch {}

export const LANG = lang;
export const LOCALE = lang === "ru" ? "ru-RU" : "en-US";

/** Текст на языке телефона: L("Привет", "Hello") */
export const L = (ru: string, en: string) => (lang === "ru" ? ru : en);
