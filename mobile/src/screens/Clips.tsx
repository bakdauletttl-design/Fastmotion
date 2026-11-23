import { Image } from "expo-image";
import { Directory, File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, Share, View } from "react-native";
import { api, Clip, withToken } from "../api";
import { Button, c, Chips, H1, P, s, Tag } from "../ui";

const KIND: Record<string, string> = { chat: "ЧАТ", audio: "ЗВУК", manual: "МОМЕНТ", edit: "МОНТАЖ" };

function shortReason(clip: Clip): string {
  const m = clip.reason.match(/x(\d+(?:\.\d)?)/);
  return m ? `${KIND[clip.kind] ?? "МОМЕНТ"} x${Math.round(Number(m[1]))}` : KIND[clip.kind] ?? "МОМЕНТ";
}

const time = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

// Скачать клип в галерею телефона
async function download(url: string) {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    Alert.alert("Нет доступа к галерее", "Разреши HypeCut сохранять видео в настройках телефона.");
    return;
  }
  const dir = new Directory(Paths.cache, "clips");
  if (!dir.exists) dir.create();
  const file: File = await File.downloadFileAsync(url, dir, { idempotent: true });
  await MediaLibrary.Asset.create(file.uri);
  Alert.alert("Сохранено", "Клип в галерее телефона.");
}

function Player({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const [vertical, setVertical] = useState(!!clip.vertical);
  const [saving, setSaving] = useState(false);
  const url = withToken(vertical && clip.vertical ? clip.vertical : clip.video);
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.play();
  });

  async function save() {
    setSaving(true);
    try {
      await download(url);
    } catch (e: any) {
      Alert.alert("Не получилось скачать", String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 }}>
      <View style={[s.row, { marginBottom: 14 }]}>
        <View style={{ flex: 1 }}>
          <P style={{ fontWeight: "700", fontSize: 17 }} numberOfLines={2}>{clip.title ?? clip.channel}</P>
          <P dim style={{ fontSize: 13 }}>{clip.title ? `${clip.channel} · ` : ""}{clip.platform_title} · {clip.reason}</P>
        </View>
        <Button title="Закрыть" kind="text" onPress={onClose} />
      </View>
      <View style={{ flex: 1, borderRadius: 24, overflow: "hidden", backgroundColor: c.card }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
        {clip.messages.length > 0 && (
          <View pointerEvents="none" style={{ position: "absolute", left: 12, right: 12, bottom: 56, gap: 6 }}>
            {clip.messages.slice(-3).map((m, i) => (
              <View key={i} style={{ alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10,
                                     paddingHorizontal: 10, paddingVertical: 5 }}>
                <P style={{ fontSize: 13 }} numberOfLines={1}>{m}</P>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Chips
          items={[{ id: "h", title: "16:9" }, ...(clip.vertical ? [{ id: "v", title: "9:16 TikTok" }] : [])]}
          value={vertical ? "v" : "h"}
          onChange={(v) => setVertical(v === "v")}
        />
        {clip.moment != null && <Tag>момент на {time(clip.moment)}</Tag>}
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Button style={{ flex: 1 }} kind="outline" title="Скачать" busy={saving} onPress={save} />
        <Button style={{ flex: 1 }} title="Поделиться" onPress={() => Share.share({ url, message: url })} />
      </View>
    </View>
  );
}

export default function Clips() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Clip | null>(null);
  const [filter, setFilter] = useState("all");
  const [seen, setSeen] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClips(await api.clips());
    } catch {}
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // «новые» = пришли с прошлого открытия ленты
  useEffect(() => {
    if (clips.length && seen === null) setSeen(Date.now() / 1000 - 6 * 3600);
  }, [clips]);

  const channels = useMemo(() => {
    const keys: { id: string; title: string }[] = [];
    for (const cl of clips) if (!keys.find((k) => k.id === cl.channel_key)) keys.push({ id: cl.channel_key, title: cl.channel });
    return [{ id: "all", title: "Все" }, ...keys];
  }, [clips]);
  const shown = filter === "all" ? clips : clips.filter((x) => x.channel_key === filter);
  const fresh = seen ? clips.filter((x) => x.created > seen).length : 0;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={shown}
        keyExtractor={(x) => x.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <View style={s.row}>
              <H1>Клипы</H1>
              {fresh > 0 && <Tag>+{fresh} НОВЫХ</Tag>}
            </View>
            {channels.length > 2 && <Chips items={channels} value={filter} onChange={setFilter} />}
          </View>
        }
        ListEmptyComponent={
          <View style={[s.card, { marginTop: 8 }]}>
            <P style={{ fontWeight: "700" }}>Пока пусто</P>
            <P dim>Добавь каналы во вкладке «Каналы». Как только стример выйдет в эфир, клипы появятся здесь и в Telegram.</P>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setOpen(item)} style={{ flex: 1 }}>
            <View style={{ aspectRatio: 9 / 12, borderRadius: 18, overflow: "hidden", backgroundColor: c.card }}>
              {item.thumb && <Image source={{ uri: withToken(item.thumb) }} style={{ flex: 1 }} contentFit="cover" />}
              <View style={{ position: "absolute", top: 9, left: 9 }}>
                <Tag>{shortReason(item)}</Tag>
              </View>
              <View style={{ position: "absolute", right: 9, bottom: 9, backgroundColor: "rgba(0,0,0,0.55)",
                             borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <P style={{ fontSize: 12, fontWeight: "700" }}>{time(item.duration)}</P>
              </View>
            </View>
            <P style={{ fontWeight: "700", marginTop: 8 }} numberOfLines={2}>{item.title ?? item.channel}</P>
            <P dim style={{ fontSize: 13 }} numberOfLines={1}>
              {item.title ? `${item.channel} · ` : `${item.platform_title} · `}
              {new Date(item.created * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </P>
          </Pressable>
        )}
      />
      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        {open && <Player clip={open} onClose={() => setOpen(null)} />}
      </Modal>
    </View>
  );
}
