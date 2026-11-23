import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, Share, View } from "react-native";
import { api, Clip, withToken } from "../api";
import { Button, c, H1, P, s, Tag } from "../ui";

function Player({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const [vertical, setVertical] = useState(false);
  const url = withToken(vertical && clip.vertical ? clip.vertical : clip.video);
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 }}>
      <View style={[s.row, { marginBottom: 16 }]}>
        <View>
          <P style={{ fontWeight: "700" }}>{clip.channel}</P>
          <P dim style={{ fontSize: 13 }}>{clip.reason}</P>
        </View>
        <Button title="Закрыть" kind="text" onPress={onClose} />
      </View>
      <VideoView player={player} style={{ flex: 1, borderRadius: 20, backgroundColor: c.card }}
                 contentFit="contain" nativeControls />
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        {clip.vertical && (
          <Button style={{ flex: 1 }} kind="outline" title={vertical ? "Горизонтально" : "Вертикально 9:16"}
                  onPress={() => setVertical(!vertical)} />
        )}
        <Button style={{ flex: 1 }} title="Поделиться" onPress={() => Share.share({ url, message: url })} />
      </View>
    </View>
  );
}

export default function Clips() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Clip | null>(null);

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

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={clips}
        keyExtractor={(x) => x.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        ListHeaderComponent={<H1>Клипы</H1>}
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
              <View style={{ position: "absolute", top: 10, left: 10 }}>
                <Tag>{item.kind === "chat" ? "ЧАТ" : item.kind === "audio" ? "ЗВУК" : "МОМЕНТ"}</Tag>
              </View>
            </View>
            <P style={{ fontWeight: "700", marginTop: 8 }} >{item.channel}</P>
            <P dim style={{ fontSize: 13 }}>
              {new Date(item.created * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              {" · "}{Math.round(item.duration)} с
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
