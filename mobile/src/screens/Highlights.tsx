// Хайлайты: несколько моментов подряд в одном ролике
import { Image } from "expo-image";
import React, { useState } from "react";
import { Alert, ScrollView, Switch, TextInput, View } from "react-native";
import { api, Me, Rendered, Style, withToken } from "../api";
import { reel, useReel } from "../highlights";
import { L } from "../i18n";
import { Button, c, Chips, P, s } from "../ui";
import { Result } from "./Editor";
import StylePanel, { transitions } from "./StylePanel";

export default function Highlights({ me, onClose }: { me: Me | null; onClose: () => void }) {
  const items = useReel();
  const canVertical = !!me?.plan?.vertical;
  const [vertical, setVertical] = useState(canVertical);
  const [subtitles, setSubtitles] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Rendered | null>(null);
  const [style, setStyle] = useState<Style>({ font: "classic", music_volume: 0.35, overlay_pos: "top" });
  const [transition, setTransition] = useState("fade");
  const total = items.reduce((a, x) => a + (x.end - x.start), 0);

  async function build() {
    setBusy(true);
    try {
      setDone(await api.highlights(items.map(({ clip, start, end }) => ({ clip, start, end })), vertical, subtitles, title,
                                     { ...style, transition }));
    } catch (e: any) {
      Alert.alert(L("Не получилось склеить", "Could not build"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 32 }}>
      <View style={[s.row, { marginBottom: 12 }]}>
        <P style={{ fontWeight: "800", fontSize: 20 }}>{L("Хайлайты", "Highlights")}</P>
        <Button title={L("Закрыть", "Close")} kind="text" onPress={onClose} />
      </View>
      {done ? (
        <Result video={done.video} onBack={() => setDone(null)} onTelegram={() => api.sendHighlights(done.id)} />
      ) : (
        <ScrollView contentContainerStyle={{ gap: 12 }}>
          <P dim style={{ fontSize: 13 }}>
            {items.length} {L("моментов", "moments")} · {Math.round(total)} {L("сек", "s")}.{" "}
            {L("Порядок меняется стрелками.", "Use the arrows to reorder.")}
          </P>
          {items.map((x, i) => (
            <View key={`${x.clip}-${i}`} style={[s.card, s.row, { padding: 10, gap: 10 }]}>
              <View style={{ width: 64, height: 40, borderRadius: 8, overflow: "hidden", backgroundColor: c.bg }}>
                {x.thumb && <Image source={{ uri: withToken(x.thumb) }} style={{ flex: 1 }} contentFit="cover" />}
              </View>
              <View style={{ flex: 1 }}>
                <P numberOfLines={1} style={{ fontWeight: "700" }}>{i + 1}. {x.title}</P>
                <P dim style={{ fontSize: 12 }}>{(x.end - x.start).toFixed(1)} {L("сек", "s")}</P>
              </View>
              <Button kind="text" title="↑" onPress={() => reel.move(i, -1)} />
              <Button kind="text" title="↓" onPress={() => reel.move(i, 1)} />
              <Button kind="text" title="✕" onPress={() => reel.remove(i)} />
            </View>
          ))}
          <Chips
            items={[{ id: "v", title: L("9:16 вебка + игра", "9:16 cam + game") }, { id: "h", title: "16:9" }]}
            value={vertical ? "v" : "h"}
            onChange={(v) => (v === "v" && !canVertical
              ? Alert.alert(L("Вертикальные клипы есть на Creator и выше", "Vertical clips are on Creator and above"))
              : setVertical(v === "v"))}
          />
          {vertical && (
            <>
              <TextInput style={s.input} value={title} onChangeText={setTitle} maxLength={80}
                         placeholder={L("Заголовок в начале ролика", "Title at the start")} placeholderTextColor={c.dim} />
              <View style={[s.row, s.card, { paddingVertical: 10 }]}>
                <P>{L("Субтитры по словам", "Word-by-word captions")}</P>
                <Switch value={subtitles} onValueChange={setSubtitles} trackColor={{ true: c.accent, false: c.line }} />
              </View>
            </>
          )}
          <View style={{ gap: 8 }}>
            <P style={{ fontWeight: "700" }}>{L("Переход между моментами", "Transition between moments")}</P>
            <Chips items={transitions()} value={transition} onChange={setTransition} />
          </View>
          <StylePanel value={style} onChange={setStyle} vertical={vertical} />
          <Button title={L("Склеить ролик", "Build video")} busy={busy} disabled={!items.length} onPress={build} />
          <Button kind="text" title={L("Очистить", "Clear")} onPress={() => { reel.clear(); onClose(); }} />
        </ScrollView>
      )}
    </View>
  );
}
