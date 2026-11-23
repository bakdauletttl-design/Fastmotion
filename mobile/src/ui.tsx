// Стиль HypeCut: тёмный фон, светлый текст, изумрудный акцент
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";
import { L } from "./i18n";

// Темы оформления: человек выбирает в профиле. Изумрудная тёмная совпадает с фирменными токенами (brand/tokens.json)
export type ThemeId = "emerald" | "light" | "neon" | "sunset";
type Palette = {
  bg: string; fg: string; dim: string; line: string; card: string;
  accent: string; accentDim: string; onAccent: string; danger: string; dark: boolean; radius: number;
};

export const THEMES: Record<ThemeId, Palette> = {
  emerald: { bg: "#07080A", fg: "#F4F6F3", dim: "#8C948F", line: "rgba(255,255,255,0.08)", card: "#0F1113",
             accent: "#2EE59D", accentDim: "rgba(46,229,157,0.12)", onAccent: "#00140C", danger: "#FF5A5A", dark: true, radius: 20 },
  light: { bg: "#F5F7F6", fg: "#0D1512", dim: "#5E6B66", line: "rgba(13,21,18,0.10)", card: "#FFFFFF",
           accent: "#0FA968", accentDim: "rgba(15,169,104,0.12)", onAccent: "#FFFFFF", danger: "#E5484D", dark: false, radius: 20 },
  neon: { bg: "#0B0716", fg: "#F3EFFF", dim: "#958BB0", line: "rgba(190,160,255,0.12)", card: "#150E26",
          accent: "#A777FF", accentDim: "rgba(167,119,255,0.16)", onAccent: "#12062B", danger: "#FF5C8A", dark: true, radius: 14 },
  sunset: { bg: "#0E0A08", fg: "#FFF4EC", dim: "#A39087", line: "rgba(255,170,120,0.12)", card: "#1A130F",
            accent: "#FF7A3D", accentDim: "rgba(255,122,61,0.14)", onAccent: "#1E0A00", danger: "#FF4D4D", dark: true, radius: 24 },
};

/** Текущие цвета. Меняются на месте при смене темы, потом приложение перерисовывается целиком. */
export const c: Palette = { ...THEMES.emerald };

// Шрифты с казахскими буквами: Montserrat для заголовков, Onest для текста
export const FONT = {
  regular: "Onest_400Regular", medium: "Onest_500Medium", semibold: "Onest_600SemiBold", bold: "Onest_700Bold",
  heading: "Montserrat_800ExtraBold", headingBlack: "Montserrat_900Black",
};
let fontsReady = false;
export const setFontsReady = (v: boolean) => { fontsReady = v; };

/** Семейство шрифта по толщине: на Android жирность со своим шрифтом не работает, нужен отдельный файл. */
export function ff(weight?: TextStyle["fontWeight"]): TextStyle {
  if (!fontsReady) return weight ? { fontWeight: weight } : {};
  const w = Number(weight === "bold" ? 700 : weight === "normal" || !weight ? 400 : weight);
  const fontFamily = w >= 800 ? FONT.heading : w >= 700 ? FONT.bold : w >= 600 ? FONT.semibold : w >= 500 ? FONT.medium : FONT.regular;
  return { fontFamily, fontWeight: "normal" };
}

/** Текст со шрифтом приложения: толщина из style превращается в нужный файл шрифта. */
function withFont(style: any) {
  const flat = StyleSheet.flatten(style) ?? {};
  return [flat, ff(flat.fontWeight)];
}

export function applyTheme(id: ThemeId) {
  Object.assign(c, THEMES[id] ?? THEMES.emerald);
  Object.assign(s, makeStyles());
}

export function Button(props: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "outline" | "text";
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const kind = props.kind ?? "primary";
  const off = props.disabled || props.busy;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={off}
      style={({ pressed }) => [
        s.btn,
        kind === "primary" && s.primary,
        kind === "outline" && s.outline,
        kind === "text" && s.textBtn,
        (pressed || off) && { opacity: 0.6 },
        props.style,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={kind === "primary" ? c.onAccent : c.fg} />
      ) : (
        <Text style={withFont([s.btnText, kind === "primary" ? { color: c.onAccent } : { color: c.fg }])}>{props.title}</Text>
      )}
    </Pressable>
  );
}

export function H1(p: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[...withFont([s.h1, p.style]), fontsReady ? { fontFamily: FONT.heading } : null]}>{p.children}</Text>;
}

export function P(p: { children: React.ReactNode; dim?: boolean; style?: TextStyle; numberOfLines?: number; onPress?: () => void }) {
  return (
    <Text numberOfLines={p.numberOfLines} onPress={p.onPress} style={withFont([s.p, p.dim && { color: c.dim }, p.style])}>
      {p.children}
    </Text>
  );
}

// маленькая зелёная плашка, например «PRO» или «LIVE»
export function Tag(p: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: c.accentDim, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={withFont({ color: c.accent, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 })}>{p.children}</Text>
    </View>
  );
}

export function Screen(p: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.screen, p.style]}>{p.children}</View>;
}

export { withFont };

const makeStyles = () => ({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 20 },
  h1: { color: c.fg, fontSize: 30, fontWeight: "800", letterSpacing: -0.8, marginBottom: 8 },
  p: { color: c.fg, fontSize: 16, lineHeight: 22 },
  btn: { height: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primary: { backgroundColor: c.accent },
  outline: { borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
  textBtn: { height: 40 },
  btnText: { fontSize: 16, fontWeight: "600" },
  input: {
    height: 54, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 14,
    color: c.fg, fontSize: 16, fontFamily: fontsReady ? FONT.regular : undefined,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: c.radius, padding: 16 },
} as const);
export const s: ReturnType<typeof makeStyles> = { ...makeStyles() } as any;

// Площадки: название и фирменный цвет для маленькой метки
type PlatformInfo = { id: "twitch" | "youtube" | "kick" | "vk" | "tiktok"; title: string; color: string; hint: string };
export const platforms = (): PlatformInfo[] => [
  { id: "twitch", title: "Twitch", color: "#9D6BFF", hint: L("ник или ссылка", "name or link") },
  { id: "youtube", title: "YouTube", color: "#FF4E45", hint: L("@канал или ссылка", "@channel or link") },
  { id: "kick", title: "Kick", color: "#53FC18", hint: L("ник или ссылка", "name or link") },
  { id: "vk", title: L("VK Видео", "VK Video"), color: "#0077FF", hint: L("ник или ссылка", "name or link") },
  { id: "tiktok", title: "TikTok", color: "#FE2C55", hint: L("@ник или ссылка", "@name or link") },
];

export const platformColor = (id: string) => platforms().find((p) => p.id === id)?.color ?? c.accent;

// Переключатели-«таблетки»: площадка, фильтр по каналу
export function Chips<T extends string>(p: { items: { id: T; title: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {p.items.map((it) => {
        const on = it.id === p.value;
        return (
          <Pressable key={it.id} onPress={() => p.onChange(it.id)}
                     style={{ paddingHorizontal: 14, height: 34, borderRadius: 999, justifyContent: "center",
                              backgroundColor: on ? c.accent : c.card, borderWidth: 1, borderColor: on ? c.accent : c.line }}>
            <Text style={withFont({ color: on ? c.onAccent : c.dim, fontWeight: "700", fontSize: 13 })}>{it.title}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
