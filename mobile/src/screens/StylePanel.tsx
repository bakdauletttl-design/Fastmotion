// Оформление в монтаже: шрифт, цвета, своя музыка, своё видео поверх, переход между кусками.
// Части используются по отдельности в панелях редактора и вместе в хайлайтах.
import * as DocumentPicker from "expo-document-picker";
import React, { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { api, Style } from "../api";
import { L } from "../i18n";
import { Button, c, Chips, Icon, P, s } from "../ui";

export const fontChoices = () => [
  { id: "classic", title: L("Обычный", "Classic") },
  { id: "russo", title: "Russo" },
  { id: "rubik", title: "Rubik Mono" },
  { id: "lobster", title: "Lobster" },
  { id: "pixel", title: L("Пиксельный", "Pixel") },
];

export const transitions = () => [
  { id: "none", title: L("Без перехода", "None") },
  { id: "fade", title: L("Плавно", "Fade") },
  { id: "slide", title: L("Сдвиг", "Slide") },
  { id: "zoom", title: L("Зум", "Zoom") },
  { id: "wipe", title: L("Шторка", "Wipe") },
  { id: "flash", title: L("Вспышка", "Flash") },
];

const SWATCHES = ["#FFFFFF", "#FFE500", "#2EE59D", "#FF3B3B", "#FF4FD8", "#3BA7FF", "#FF8A00", "#111111"];
export const DEFAULT_COLORS = { text: "#FFFFFF", word: "#2EE59D", title: "#FFE500" };

// ряд кружков-цветов; выбранный обведён
export function ColorRow({ label, value, fallback, onPick }: { label: string; value?: string | null; fallback: string; onPick: (c: string) => void }) {
  const cur = (value ?? fallback).toUpperCase();
  return (
    <View style={{ gap: 8 }}>
      <P dim style={{ fontSize: 12 }}>{label}</P>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        {SWATCHES.map((col) => (
          <Pressable key={col} onPress={() => onPick(col)} hitSlop={4}
                     style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: col, borderWidth: cur === col ? 3 : 1,
                              borderColor: cur === col ? c.accent : c.line }} />
        ))}
      </View>
    </View>
  );
}

export const volumes = () => [{ id: "0.15", title: L("Тихо", "Quiet") }, { id: "0.35", title: L("Средне", "Medium") }, { id: "0.7", title: L("Громко", "Loud") }];

/** Загрузить файл с телефона на сервер. Возвращает id для монтажа или null, если человек передумал. */
async function pick(kind: "audio" | "video"): Promise<{ id: string; name: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: kind === "audio" ? "audio/*" : "video/*", copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const { id } = await api.upload(kind, a.uri);
  return { id, name: a.name };
}

// названия выбранных файлов живут, пока открыт монтаж
const names: Record<string, string> = {};

/** Музыка или видео поверх: выбрать с телефона, громкость или место, убрать. */
export function MediaPanel({ kind, value, onChange }: { kind: "audio" | "video"; value: Style; onChange: (s: Style) => void }) {
  const [busy, setBusy] = useState(false);
  const has = kind === "audio" ? value.music : value.overlay;

  async function choose() {
    setBusy(true);
    try {
      const got = await pick(kind);
      if (got) {
        names[kind] = got.name;
        onChange({ ...value, ...(kind === "audio" ? { music: got.id } : { overlay: got.id }) });
      }
    } catch (e: any) {
      Alert.alert(L("Файл не загрузился", "Upload failed"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      {has ? (
        <>
          <View style={[s.row, { backgroundColor: c.raised, borderRadius: 10, paddingHorizontal: 12, height: 44 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Icon name={kind === "audio" ? "musical-notes" : "film"} size={18} color={c.accent} />
              <P numberOfLines={1} style={{ fontSize: 14, flex: 1 }}>
                {names[kind] ?? (kind === "audio" ? L("Трек загружен", "Track uploaded") : L("Видео загружено", "Video uploaded"))}
              </P>
            </View>
            <Pressable hitSlop={8} onPress={() => onChange({ ...value, ...(kind === "audio" ? { music: null } : { overlay: null }) })}>
              <Icon name="trash-outline" size={18} color={c.dim} />
            </Pressable>
          </View>
          {kind === "audio" ? (
            <Chips items={volumes()} value={String(value.music_volume ?? 0.35)} onChange={(v) => onChange({ ...value, music_volume: Number(v) })} />
          ) : (
            <Chips items={[{ id: "top", title: L("Крупно сверху", "Big on top") }, { id: "corner", title: L("В углу", "In the corner") }]}
                   value={value.overlay_pos ?? "top"} onChange={(overlay_pos) => onChange({ ...value, overlay_pos })} />
          )}
        </>
      ) : (
        <>
          {kind === "video" && <P dim style={{ fontSize: 12 }}>{L("Мем, реакция или своё лицо поверх клипа.", "A meme, a reaction or your face over the clip.")}</P>}
          <Button kind="outline" icon="add" busy={busy} onPress={choose}
                  title={kind === "audio" ? L("Выбрать трек с телефона", "Pick a track from phone") : L("Выбрать видео с телефона", "Pick a video from phone")} />
        </>
      )}
      <P dim style={{ fontSize: 11 }}>
        {L("Используй музыку и видео, на которые у тебя есть права.", "Use only music and video you have the rights to.")}
      </P>
    </View>
  );
}

/** Шрифт и цвета субтитров. */
export function FontPanel({ value, onChange }: { value: Style; onChange: (s: Style) => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Chips items={fontChoices()} value={value.font ?? "classic"} onChange={(font) => onChange({ ...value, font })} />
      <ColorRow label={L("Цвет текста", "Text color")} value={value.text_color} fallback={DEFAULT_COLORS.text}
                onPick={(col) => onChange({ ...value, text_color: col })} />
      <ColorRow label={L("Цвет слова, которое звучит", "Color of the spoken word")} value={value.word_color} fallback={DEFAULT_COLORS.word}
                onPick={(col) => onChange({ ...value, word_color: col })} />
    </View>
  );
}

/** Всё сразу: для хайлайтов. */
export default function StylePanel({ value, onChange, vertical }: { value: Style; onChange: (s: Style) => void; vertical: boolean }) {
  return (
    <View style={{ gap: 12 }}>
      {vertical && (
        <View style={[s.card, { gap: 10 }]}>
          <P style={{ fontWeight: "700" }}>{L("Шрифт субтитров и заголовка", "Caption and title font")}</P>
          <FontPanel value={value} onChange={onChange} />
          <ColorRow label={L("Цвет заголовка", "Title color")} value={value.title_color} fallback={DEFAULT_COLORS.title}
                    onPick={(col) => onChange({ ...value, title_color: col })} />
        </View>
      )}
      <View style={[s.card, { gap: 10 }]}>
        <P style={{ fontWeight: "700" }}>{L("Музыка", "Music")}</P>
        <MediaPanel kind="audio" value={value} onChange={onChange} />
      </View>
      <View style={[s.card, { gap: 10 }]}>
        <P style={{ fontWeight: "700" }}>{L("Видео сверху", "Video on top")}</P>
        <MediaPanel kind="video" value={value} onChange={onChange} />
      </View>
    </View>
  );
}
