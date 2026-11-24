// Вкладка «Монтаж»: выбираешь готовый клип и монтируешь его, или собираешь хайлайты
import { Image } from "expo-image";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { api, Clip, Me, withToken } from "../api";
import { useReel } from "../highlights";
import { L } from "../i18n";
import { Project, projects, useProjects } from "../project";
import { c, Chips, H1, Icon, P, s, Tag } from "../ui";
import Editor from "./Editor";
import Highlights from "./Highlights";
import Scrub, { justScrubbed } from "./Scrub";

export default function Montage({ me }: { me: Me | null }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "fav" | "mine">("all");
  const [editing, setEditing] = useState<Clip | null>(null);
  const [reelOpen, setReelOpen] = useState(false);
  const [openProj, setOpenProj] = useState<Project | null>(null);
  const moments = useReel();
  const saved = useProjects();

  function projMenu(p: Project) {
    Alert.alert(p.name, L("Что сделать с проектом?", "What to do with the project?", "Жобамен не істейміз?"), [
      { text: L("Открыть", "Open", "Ашу"), onPress: () => setOpenProj(p) },
      { text: L("Удалить", "Delete", "Өшіру"), style: "destructive", onPress: () => projects.remove(p.id) },
      { text: L("Отмена", "Cancel", "Болдырмау"), style: "cancel" },
    ]);
  }

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
        numColumns={2}
        columnWrapperStyle={{ gap: 10 }}
        contentContainerStyle={{ gap: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <H1>{L("Монтаж", "Editor")}</H1>
            <Pressable onPress={() => setReelOpen(true)} disabled={!moments.length}
                       style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 }]}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                <Icon name="albums" size={22} color={c.onAccent} />
              </View>
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: "700" }}>{L("Хайлайты", "Highlights")} · {moments.length}</P>
                <P dim style={{ fontSize: 12 }}>
                  {moments.length ? L("Склеить моменты в один ролик с переходами", "Join moments into one video with transitions")
                                  : L("Добавь моменты кнопкой «+ В хайлайты» в монтаже", "Add moments with “+ Add to highlights” in the editor")}
                </P>
              </View>
              <Icon name="chevron-forward" size={20} color={c.dim} />
            </Pressable>
            {saved.length > 0 && (
              <View style={{ gap: 8 }}>
                <P style={{ fontWeight: "700", marginTop: 4 }}>{L("Мои проекты", "My projects", "Менің жобаларым")} · {saved.length}</P>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {saved.map((p) => {
                    const first = p.segs[0]?.clip;
                    const len = p.segs.reduce((a, x) => a + x.end - x.start, 0);
                    return (
                      <Pressable key={p.id} onPress={() => setOpenProj(p)} onLongPress={() => projMenu(p)} style={{ width: 132, gap: 5 }}>
                        <View style={{ aspectRatio: 3 / 4, borderRadius: 10, overflow: "hidden", backgroundColor: c.raised }}>
                          {first?.thumb && <Image source={{ uri: withToken(first.thumb) }} style={{ flex: 1 }} contentFit="cover" />}
                          <View style={{ position: "absolute", left: 6, top: 6, flexDirection: "row", gap: 4 }}>
                            <Tag>{p.aspect}</Tag>
                          </View>
                          {p.exports.length > 0 && (
                            <View style={{ position: "absolute", right: 6, top: 6 }}><Icon name="checkmark-circle" size={18} color={c.accent} /></View>
                          )}
                          <Pressable hitSlop={8} onPress={() => projMenu(p)} style={{ position: "absolute", right: 4, bottom: 4, width: 28, height: 28, borderRadius: 14,
                                                                                        backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
                            <Icon name="ellipsis-horizontal" size={16} color="#fff" />
                          </Pressable>
                          <View style={{ position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 4, paddingHorizontal: 5 }}>
                            <P style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{Math.round(len)}{L("с", "s")} · {p.segs.length} {L("кус.", "pcs")}</P>
                          </View>
                        </View>
                        <P numberOfLines={1} style={{ fontSize: 13, fontWeight: "600" }}>{p.name}</P>
                        <P dim numberOfLines={1} style={{ fontSize: 11, marginTop: -4 }}>
                          {p.exports.length ? L("Экспортирован", "Exported", "Экспортталды") : L("Черновик", "Draft", "Жоба")}
                        </P>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}
            <P style={{ fontWeight: "700", marginTop: 4 }}>{L("Выбери клип для монтажа", "Pick a clip to edit", "Монтажға клип таңда")}</P>
            <Chips items={[{ id: "all", title: L("Все клипы", "All clips") }, { id: "fav", title: L("Любимые", "Favorites") },
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
          <Pressable onPress={() => !justScrubbed() && setEditing(item)} style={{ flex: 1 / 2, gap: 6 }}>
            <Scrub clip={item}>
              <View style={{ position: "absolute", right: 6, bottom: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                <P style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{Math.round(item.source_duration ?? item.duration)}{L("с", "s")}</P>
              </View>
              {item.fav ? <View style={{ position: "absolute", left: 6, top: 6 }}><Icon name="heart" size={16} color="#FF4D6D" /></View> : null}
              {item.kind === "user" ? <View style={{ position: "absolute", right: 6, top: 6 }}><Tag>{L("МОЙ", "MINE")}</Tag></View> : null}
            </Scrub>
            <P style={{ fontWeight: "600", fontSize: 13 }} numberOfLines={1}>{item.title ?? item.channel}</P>
            <P dim style={{ fontSize: 11, marginTop: -4 }} numberOfLines={1}>{item.channel}</P>
          </Pressable>
        )}
      />
      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && <Editor clip={editing} me={me} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal visible={!!openProj} animationType="slide" onRequestClose={() => setOpenProj(null)}>
        {openProj && <Editor project={openProj} me={me} onClose={() => setOpenProj(null)} />}
      </Modal>
      <Modal visible={reelOpen} animationType="slide" onRequestClose={() => setReelOpen(false)}>
        <Highlights me={me} onClose={() => setReelOpen(false)} />
      </Modal>
    </View>
  );
}
