// Эфир прямо в приложении: смотришь стрим и жмёшь «Клип», когда случилось что-то яркое
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, Text, View } from "react-native";
import { api, Channel, Clip, LiveInfo, Me } from "../api";
import { L } from "../i18n";
import { Button, c, Chips, P, s } from "../ui";
import Editor from "./Editor";

function Stream({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => p.play());
  useEffect(() => () => player.pause(), [player]);
  return (
    <>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
      <CutButton player={player} />
    </>
  );
}

// кнопка живёт рядом с плеером: ей нужно знать, насколько плеер отстаёт от эфира
let cutHandler: ((behind: number) => void) | null = null;
function CutButton({ player }: { player: { currentOffsetFromLive: number | null } }) {
  return (
    <Pressable onPress={() => cutHandler?.(player.currentOffsetFromLive ?? 0)}
               style={({ pressed }) => ({ position: "absolute", right: 14, bottom: 14, width: 84, height: 84, borderRadius: 42,
                                          backgroundColor: c.accent, alignItems: "center", justifyContent: "center",
                                          opacity: pressed ? 0.7 : 1, shadowColor: c.accent, shadowOpacity: 0.6, shadowRadius: 16 })}>
      <Text style={{ fontSize: 26 }}>✂️</Text>
      <Text style={{ color: c.onAccent, fontWeight: "900", fontSize: 13 }}>{L("КЛИП", "CLIP")}</Text>
    </Pressable>
  );
}

export default function Live({ channel, me, onClose }: { channel: Channel; me: Me | null; onClose: () => void }) {
  const [info, setInfo] = useState<LiveInfo | null>(null);
  const [seconds, setSeconds] = useState("30");
  const [cutting, setCutting] = useState(false);
  const [made, setMade] = useState<Clip[]>([]);
  const [edit, setEdit] = useState<Clip | null>(null);
  const name = channel.display ?? channel.name.replace(/^@/, "");

  useEffect(() => {
    api.live(channel.key).then(setInfo).catch(() => setInfo({ live: false, max_seconds: 60, playlist: null, url: channel.url }));
  }, [channel.key]);

  cutHandler = async (behind: number) => {
    if (cutting) return;
    setCutting(true);
    try {
      const clip = await api.cut(channel.key, Number(seconds), behind);
      setMade((m) => [clip, ...m]);
      setEdit(clip); // сразу в монтаж: обрезать, вертикаль, субтитры
    } catch (e: any) {
      Alert.alert(L("Клип не получился", "Clip failed"), String(e?.message ?? e));
    } finally {
      setCutting(false);
    }
  };

  const lengths = [15, 30, 60, 90, 120].filter((x) => !info || x <= info.max_seconds);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 32 }}>
      <View style={[s.row, { marginBottom: 12 }]}>
        <View style={{ flex: 1 }}>
          <P style={{ fontWeight: "800", fontSize: 20 }} numberOfLines={1}>{name}</P>
          <P style={{ color: c.danger, fontSize: 12, fontWeight: "800" }}>● LIVE · {channel.platform_title}</P>
        </View>
        <Button title={L("Закрыть", "Close")} kind="text" onPress={onClose} />
      </View>

      <View style={{ aspectRatio: 16 / 9, borderRadius: 20, overflow: "hidden", backgroundColor: c.card, justifyContent: "center" }}>
        {!info ? <ActivityIndicator color={c.accent} />
          : info.playlist ? <Stream url={info.playlist} />
          : (
            <View style={{ padding: 16, gap: 10 }}>
              <P>{L("Стример сейчас не в эфире или запись ещё не началась.", "The streamer is offline or recording has not started yet.")}</P>
              <Button kind="outline" title={L("Открыть канал", "Open channel")} onPress={() => Linking.openURL(info.url)} />
            </View>
          )}
        {cutting && (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)",
                         alignItems: "center", justifyContent: "center", gap: 8 }}>
            <ActivityIndicator color={c.accent} size="large" />
            <P>{L("Режу клип…", "Cutting the clip…")}</P>
          </View>
        )}
      </View>

      <View style={{ gap: 10, marginTop: 16 }}>
        <P dim style={{ fontSize: 13 }}>{L("Сколько секунд до нажатия взять в клип", "How many seconds before the tap to keep")}</P>
        <Chips items={lengths.map((x) => ({ id: String(x), title: `${x} ${L("сек", "s")}` }))} value={seconds} onChange={setSeconds} />
        <P dim style={{ fontSize: 12 }}>
          {L("Жми ✂️ КЛИП, когда случилось что-то яркое. Автоклипы при этом тоже продолжают приходить.",
             "Tap ✂️ CLIP when something great happens. Auto clips keep coming too.")}
        </P>
      </View>

      {made.length > 0 && (
        <View style={[s.card, { marginTop: 14, gap: 6 }]}>
          <P style={{ fontWeight: "700" }}>{L("Твои клипы с этого эфира", "Your clips from this stream")}</P>
          {made.map((x) => (
            <Pressable key={x.id} onPress={() => setEdit(x)} style={[s.row, { paddingVertical: 6 }]}>
              <P numberOfLines={1} style={{ flex: 1 }}>{x.title ?? name}</P>
              <P style={{ color: c.accent, fontWeight: "700" }}>{L("Монтаж", "Edit")} ›</P>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        {edit && <Editor clip={edit} me={me} onClose={() => setEdit(null)} />}
      </Modal>
    </View>
  );
}
