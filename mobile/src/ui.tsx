// Стиль HypeCut: тёмный фон, светлый текст, изумрудный акцент
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";

// Цвета синхронизированы с фирменными токенами HypeCut (hypecut/static/brand.css), акцент изумрудный
export const c = {
  bg: "#07080A", fg: "#F4F6F3", dim: "#8C948F", line: "rgba(255,255,255,0.08)", card: "#0F1113",
  accent: "#2EE59D", accentDim: "rgba(46,229,157,0.12)", onAccent: "#00140C", danger: "#FF5A5A",
};

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
        <Text style={[s.btnText, kind === "primary" ? { color: c.onAccent } : { color: c.fg }]}>{props.title}</Text>
      )}
    </Pressable>
  );
}

export function H1(p: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h1, p.style]}>{p.children}</Text>;
}

export function P(p: { children: React.ReactNode; dim?: boolean; style?: TextStyle }) {
  return <Text style={[s.p, p.dim && { color: c.dim }, p.style]}>{p.children}</Text>;
}

// маленькая зелёная плашка, например «PRO» или «LIVE»
export function Tag(p: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: c.accentDim, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ color: c.accent, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 }}>{p.children}</Text>
    </View>
  );
}

export function Screen(p: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.screen, p.style]}>{p.children}</View>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 20 },
  h1: { color: c.fg, fontSize: 32, fontWeight: "800", letterSpacing: -1, marginBottom: 8 },
  p: { color: c.fg, fontSize: 16, lineHeight: 22 },
  btn: { height: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primary: { backgroundColor: c.accent },
  outline: { borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
  textBtn: { height: 40 },
  btnText: { fontSize: 16, fontWeight: "600" },
  input: {
    height: 54, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 14,
    color: c.fg, fontSize: 16,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 20, padding: 16 },
});
