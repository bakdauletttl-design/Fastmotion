// Оформление в монтаже: шрифт, своя музыка, своё видео поверх, переход между кусками
import * as DocumentPicker from "expo-document-picker";
import React, { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { api, Style } from "../api";
import { L } from "../i18n";
import { Button, c, Chips, P, s } from "../ui";

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

// ряд кружков-цветов; выбранный обведён
function ColorRow({ label, value, fallback, onPick }: { label: string; value?: string | null; fallback: string; onPick: (c: string) => void }) {
  const cur = (value ?? fallback).toUpperCase();
  return (
    <View style={{ gap: 6 }}>
      <P dim style={{ fontSize: 13 }}>{label}</P>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {SWATCHES.map((col) => (
          <Pressable key={col} onPress={() => onPick(col)} hitSlop={4}
                     style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: col, borderWidth: cur === col ? 3 : 1,
                              borderColor: cur === col ? c.accent : c.line }} />
        ))}
      </View>
    </View>
  );
}

const volumes = () => [{ id: "0.15", title: L("Тихо", "Quiet") }, { id: "0.35", title: L("Средне", "Medium") }, { id: "0.7", title: L("Громко", "Loud") }];

/** Загрузить файл с телефона на сервер. Возвращает id для монтажа или null, если человек передумал. */
async function pick(kind: "audio" | "video"): Promise<{ id: string; name: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: kind === "audio" ? "audio/*" : "video/*", copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const { id } = await api.upload(kind, a.uri);
  return { id, name: a.name };
}

export default function StylePanel({ value, onChange, vertical }: { value: Style; onChange: (s: Style) => void; vertical: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  async function choose(kind: "audio" | "video") {
    setBusy(kind);
    try {
      const got = await pick(kind);
      if (got) {
        setNames((n) => ({ ...n, [kind]: got.name }));
        onChange({ ...value, ...(kind === "audio" ? { music: got.id } : { overlay: got.id }) });
      }
    } catch (e: any) {
      Alert.alert(L("Файл не загрузился", "Upload failed"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {vertical && (
        <View style={{ gap: 8 }}>
          <P style={{ fontWeight: "700" }}>{L("Шрифт субтитров и заголовка", "Caption and title font")}</P>
          <Chips items={fontChoices()} value={value.font ?? "classic"} onChange={(font) => onChange({ ...value, font })} />
          <ColorRow label={L("Цвет текста", "Text color")} value={value.text_color} fallback="#FFFFFF"
                    onPick={(col) => onChange({ ...value, text_color: col })} />
          <ColorRow label={L("Цвет слова, которое звучит", "Color of the spoken word")} value={value.word_color} fallback="#2EE59D"
                    onPick={(col) => onChange({ ...value, word_color: col })} />
          <ColorRow label={L("Цвет заголовка", "Title color")} value={value.title_color} fallback="#FFE500"
                    onPick={(col) => onChange({ ...value, title_color: col })} />
        </View>
      )}

      <View style={[s.card, { gap: 10 }]}>
        <View style={s.row}>
          <P style={{ fontWeight: "700" }}>🎵 {L("Музыка", "Music")}</P>
          {value.music && <Button kind="text" title={L("Убрать", "Remove")} onPress={() => onChange({ ...value, music: null })} />}
        </View>
        {value.music ? (
          <>
            <P dim style={{ fontSize: 13 }} numberOfLines={1}>{names.audio ?? L("Трек загружен", "Track uploaded")}</P>
            <Chips items={volumes()} value={String(value.music_volume ?? 0.35)} onChange={(v) => onChange({ ...value, music_volume: Number(v) })} />
          </>
        ) : (
          <Button kind="outline" title={L("Выбрать трек с телефона", "Pick a track from phone")} busy={busy === "audio"}
                  onPress={() => choose("audio")} />
        )}
      </View>

      <View style={[s.card, { gap: 10 }]}>
        <View style={s.row}>
          <P style={{ fontWeight: "700" }}>🎞 {L("Видео сверху", "Video on top")}</P>
          {value.overlay && <Button kind="text" title={L("Убрать", "Remove")} onPress={() => onChange({ ...value, overlay: null })} />}
        </View>
        {value.overlay ? (
          <>
            <P dim style={{ fontSize: 13 }} numberOfLines={1}>{names.video ?? L("Видео загружено", "Video uploaded")}</P>
            <Chips items={[{ id: "top", title: L("Крупно сверху", "Big on top") }, { id: "corner", title: L("В углу", "In the corner") }]}
                   value={value.overlay_pos ?? "top"} onChange={(overlay_pos) => onChange({ ...value, overlay_pos })} />
          </>
        ) : (
          <>
            <P dim style={{ fontSize: 12 }}>{L("Мем, реакция или своё лицо поверх клипа.", "A meme, a reaction or your face over the clip.")}</P>
            <Button kind="outline" title={L("Выбрать видео с телефона", "Pick a video from phone")} busy={busy === "video"}
                    onPress={() => choose("video")} />
          </>
        )}
      </View>
      <P dim style={{ fontSize: 11, color: c.dim }}>
        {L("Используй музыку и видео, на которые у тебя есть права.", "Use only music and video you have the rights to.")}
      </P>
    </View>
  );
}
