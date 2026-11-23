import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, Share, View } from "react-native";
import { api, Clip, Me, withToken } from "../api";
import { useReel } from "../highlights";
import { saveToGallery as download } from "../save";
import Editor from "./Editor";
import Highlights from "./Highlights";
import { Button, c, Chips, H1, P, s, Tag } from "../ui";
import { L, LOCALE } from "../i18n";

const KIND: Record<string, string> = {
  chat: L("ЧАТ", "CHAT"),
  audio: L("ЗВУК", "AUDIO"),
  manual: L("МОМЕНТ", "MOMENT"),
  edit: L("МОНТАЖ", "EDIT"),
  viewers: L("ЗРИТЕЛИ", "VIEWERS"),
  user: L("МОЙ КЛИП", "MY CLIP"),
};

function shortReason(clip: Clip): string {
  const m = clip.reason.match(/x(\d+(?:\.\d)?)/);
  return m ? `${KIND[clip.kind] ?? KIND.manual} x${Math.round(Number(m[1]))}` : KIND[clip.kind] ?? KIND.manual;
}

const time = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

function Player({ clip, onClose, onEdit }: { clip: Clip; onClose: () => void; onEdit: () => void }) {
  const [vertical, setVertical] = useState(!!clip.vertical);
  const [saving, setSaving] = useState(false);
  const [rating, setRating] = useState(clip.rating ?? 0);
  const [fav, setFav] = useState(!!clip.fav);

  function toggleFav() {
    const next = !fav;
    setFav(next);
    clip.fav = next;
    api.fav(clip.id, next).catch(() => null);
  }

  // 👍/👎 помогает нарезке понять, какие моменты людям нравятся
  function rate(v: number) {
    const next = rating === v ? 0 : v;
    setRating(next);
    clip.rating = next;
    api.rate(clip.id, next).catch(() => null);
  }
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
      Alert.alert(L("Не получилось скачать", "Download failed"), String(e?.message ?? e));
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
        <Button title={L("Закрыть", "Close")} kind="text" onPress={onClose} />
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
        <View style={{ flex: 1 }} />
        <Pressable onPress={toggleFav}
                   style={{ width: 40, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center",
                            backgroundColor: fav ? "rgba(255,90,90,0.15)" : c.card, borderWidth: 1, borderColor: fav ? c.danger : c.line }}>
          <P>{fav ? "❤️" : "🤍"}</P>
        </Pressable>
        {[1, -1].map((v) => (
          <Pressable key={v} onPress={() => rate(v)}
                     style={{ width: 40, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center",
                              backgroundColor: rating === v ? c.accentDim : c.card,
                              borderWidth: 1, borderColor: rating === v ? c.accent : c.line }}>
            <P>{v > 0 ? "👍" : "👎"}</P>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {clip.quality ? <Tag>{clip.quality >= 1440 ? "2K" : `${clip.quality}p`}</Tag> : null}
        {clip.moment != null && <Tag>{L("момент на", "moment at")} {time(clip.moment)}</Tag>}
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Button style={{ flex: 1 }} kind="outline" title={L("Скачать", "Save")} busy={saving} onPress={save} />
        <Button style={{ flex: 1 }} kind="outline" title={L("Поделиться", "Share")} onPress={() => Share.share({ url, message: url })} />
      </View>
      <Button style={{ marginTop: 10 }} title={L("✂️ Монтаж", "✂️ Edit")} onPress={onEdit} />
    </View>
  );
}

export default function Clips({ me }: { me: Me | null }) {
  const moments = useReel();
  const [editing, setEditing] = useState<Clip | null>(null);
  const [reelOpen, setReelOpen] = useState(false);
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
    return [{ id: "all", title: L("Все", "All") }, { id: "fav", title: "❤️" }, ...keys];
  }, [clips]);
  const shown = filter === "all" ? clips : filter === "fav" ? clips.filter((x) => x.fav) : clips.filter((x) => x.channel_key === filter);

  function toggleFav(x: Clip) {
    x.fav = !x.fav;
    setClips([...clips]);
    api.fav(x.id, !!x.fav).catch(() => null);
  }
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
              <H1>{L("Клипы", "Clips")}</H1>
              {fresh > 0 && <Tag>+{fresh} {L("НОВЫХ", "NEW")}</Tag>}
            </View>
            {clips.length > 0 && <Chips items={channels} value={filter} onChange={setFilter} />}
            {moments.length > 0 && (
              <Pressable onPress={() => setReelOpen(true)}
                         style={[s.card, s.row, { borderColor: c.accent, backgroundColor: c.accentDim, paddingVertical: 12 }]}>
                <P style={{ fontWeight: "700" }}>🎬 {L("Хайлайты", "Highlights")}: {moments.length}</P>
                <P style={{ color: c.accent, fontWeight: "700" }}>{L("Склеить", "Build")} ›</P>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={[s.card, { marginTop: 8 }]}>
            <P style={{ fontWeight: "700" }}>{L("Пока пусто", "Nothing yet")}</P>
            <P dim>
              {L(
                "Добавь каналы во вкладке «Каналы». Как только стример выйдет в эфир, клипы появятся здесь и в Telegram.",
                "Add channels in the Channels tab. Once a streamer goes live, clips will appear here and in Telegram.",
              )}
            </P>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setOpen(item)} style={{ flex: 1 }}>
            <View style={{ aspectRatio: 9 / 12, borderRadius: 18, overflow: "hidden", backgroundColor: c.card }}>
              {item.thumb && <Image source={{ uri: withToken(item.thumb) }} style={{ flex: 1 }} contentFit="cover" />}
              <View style={{ position: "absolute", top: 9, left: 9 }}>
                <Tag>{shortReason(item)}</Tag>
              </View>
              <Pressable onPress={() => toggleFav(item)} hitSlop={8}
                         style={{ position: "absolute", top: 6, right: 6, width: 32, height: 32, borderRadius: 16,
                                  alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" }}>
                <P style={{ fontSize: 15 }}>{item.fav ? "❤️" : "🤍"}</P>
              </Pressable>
              <View style={{ position: "absolute", right: 9, bottom: 9, backgroundColor: "rgba(0,0,0,0.55)",
                             borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <P style={{ fontSize: 12, fontWeight: "700" }}>{time(item.duration)}</P>
              </View>
            </View>
            <P style={{ fontWeight: "700", marginTop: 8 }} numberOfLines={2}>{item.title ?? item.channel}</P>
            <P dim style={{ fontSize: 13 }} numberOfLines={1}>
              {item.title ? `${item.channel} · ` : `${item.platform_title} · `}
              {new Date(item.created * 1000).toLocaleString(LOCALE, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </P>
          </Pressable>
        )}
      />
      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        {open && <Player clip={open} onClose={() => setOpen(null)} onEdit={() => { setEditing(open); setOpen(null); }} />}
      </Modal>
      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && <Editor clip={editing} me={me} onClose={() => { setEditing(null); load(); }} />}
      </Modal>
      <Modal visible={reelOpen} animationType="slide" onRequestClose={() => setReelOpen(false)}>
        <Highlights me={me} onClose={() => setReelOpen(false)} />
      </Modal>
    </View>
  );
}
