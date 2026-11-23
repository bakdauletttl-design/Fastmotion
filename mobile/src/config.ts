// Адрес сервера и ключи. Задаются в файле .env (см. .env.example) или прямо здесь.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";
// Вход без Apple/Google, только для тестов с сервером, где DEV_LOGIN=1
export const DEV_LOGIN = process.env.EXPO_PUBLIC_DEV_LOGIN === "1";
