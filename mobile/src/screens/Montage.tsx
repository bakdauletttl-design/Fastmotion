// Вкладка «Монтаж»: выбираешь готовый клип и монтируешь его, или собираешь хайлайты
import { Image } from "expo-image";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, View } from "react-native";
import { api, Clip, Me, withToken } from "../api";
import { useReel } from "../highlights";
import { L } from "../i18n";
import { c, Chips, H1, P, s, Tag } from "../ui";
import Editor from "./Editor";
import Highlights from "./Highlights";

export default function Montage({ me }: { me: Me | null }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "fav" | "mine">("all");
  const [editing, setEditing] = useState<Clip | null>(null);
  const [reelOpen, setReelOpen] = useState(false);
  const moments = useReel();

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

  const shown = clips.filter((x) => filter === "all" || (filter === "fav" ? x.fav : x.kind === "user"));

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={shown}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <H1>{L("Монтаж", "Editor")}</H1>
            <P dim>
              {L("Выбери клип: обрежь, сделай вертикаль, поправь субтитры, добавь шрифт, музыку или своё видео сверху.",
                 "Pick a clip: trim it, go vertical, fix captions, add a font, music or your own video on top.")}
            </P>
            <Pressable onPress={() => setReelOpen(true)} disabled={!moments.length}
                       style={[s.card, s.row, { borderColor: c.accent, backgroundColor: c.accentDim, paddingVertical: 12,
                                                opacity: moments.length ? 1 : 0.6 }]}>
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: "700" }}>🎬 {L("Хайлайты", "Highlights")}: {moments.length}</P>
                <P dim style={{ fontSize: 12 }}>
                  {moments.length ? L("Склеить моменты в один ролик с переходами", "Join moments into one video with transitions")
                                  : L("Добавь моменты кнопкой «+ В хайлайты» в монтаже", "Add moments with “+ Add to highlights” in the editor")}
                </P>
              </View>
              {moments.length > 0 && <P style={{ color: c.accent, fontWeight: "700" }}>{L("Склеить", "Build")} ›</P>}
            </Pressable>
            <Chips items={[{ id: "all", title: L("Все клипы", "All clips") }, { id: "fav", title: "❤️ " + L("Любимые", "Favorites") },
                           { id: "mine", title: L("Мои вырезанные", "Cut by me") }]}
                   value={filter} onChange={setFilter} />
          </View>
        }
        ListEmptyComponent={
          <View style={s.card}>
            <P dim>{filter === "fav" ? L("Нажми ❤️ на клипе, и он появится здесь.", "Tap ❤️ on a clip and it will show up here.")
                                     : L("Клипов пока нет.", "No clips yet.")}</P>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setEditing(item)} style={[s.card, s.row, { padding: 10, gap: 12 }]}>
            <View style={{ width: 96, height: 54, borderRadius: 10, overflow: "hidden", backgroundColor: c.bg }}>
              {item.thumb && <Image source={{ uri: withToken(item.thumb) }} style={{ flex: 1 }} contentFit="cover" />}
            </View>
            <View style={{ flex: 1 }}>
              <P style={{ fontWeight: "700" }} numberOfLines={1}>{item.fav ? "❤️ " : ""}{item.title ?? item.channel}</P>
              <P dim style={{ fontSize: 12 }} numberOfLines={1}>{item.channel} · {Math.round(item.source_duration ?? item.duration)} {L("сек", "s")}</P>
            </View>
            {item.kind === "user" ? <Tag>{L("МОЙ", "MINE")}</Tag> : null}
            <P style={{ color: c.accent, fontWeight: "800" }}>✂️</P>
          </Pressable>
        )}
      />
      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && <Editor clip={editing} me={me} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal visible={reelOpen} animationType="slide" onRequestClose={() => setReelOpen(false)}>
        <Highlights me={me} onClose={() => setReelOpen(false)} />
      </Modal>
    </View>
  );
}
