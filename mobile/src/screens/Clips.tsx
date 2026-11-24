import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Platform, Pressable, RefreshControl, Share, View } from "react-native";
import { api, Clip, Me, withToken } from "../api";
import { useReel } from "../highlights";
import { saveToGallery as download } from "../save";
import Editor from "./Editor";
import Highlights from "./Highlights";
import Scrub, { justScrubbed } from "./Scrub";
import { Button, c, Chips, H1, Icon, P, s, Tag } from "../ui";
import { L, locale } from "../i18n";

const kinds = (): Record<string, string> => ({
  chat: L("ЧАТ", "CHAT"),
  audio: L("ЗВУК", "AUDIO"),
  manual: L("МОМЕНТ", "MOMENT"),
  edit: L("МОНТАЖ", "EDIT"),
  viewers: L("ЗРИТЕЛИ", "VIEWERS"),
  user: L("МОЙ КЛИП", "MY CLIP"),
});

function shortReason(clip: Clip): string {
  const KIND = kinds();
  const m = clip.reason.match(/x(\d+(?:\.\d)?)/);
  return m ? `${KIND[clip.kind] ?? KIND.manual} x${Math.round(Number(m[1]))}` : KIND[clip.kind] ?? KIND.manual;
}

/** Время эфира: 1:23:45 */
export const streamClock = (t: number) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
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
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: Platform.OS === "web" ? 12 : 56, paddingHorizontal: 16, paddingBottom: Platform.OS === "web" ? 12 : 34 }}>
      <View style={[s.row, { marginBottom: 14 }]}>
        <View style={{ flex: 1 }}>
          <P style={{ fontWeight: "700", fontSize: 17 }} numberOfLines={2}>{clip.title ?? clip.channel}</P>
          <P dim style={{ fontSize: 13 }}>{clip.title ? `${clip.channel} · ` : ""}{clip.platform_title} · {clip.reason}</P>
        </View>
        <Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={26} /></Pressable>
      </View>
      <View style={{ flex: 1, maxHeight: vertical ? 560 : 260, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls playsInline />
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
                   style={{ width: 40, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.raised }}>
          <Icon name={fav ? "heart" : "heart-outline"} size={19} color={fav ? "#FF4D6D" : c.fg} />
        </Pressable>
        {[1, -1].map((v) => (
          <Pressable key={v} onPress={() => rate(v)}
                     style={{ width: 40, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center",
                              backgroundColor: rating === v ? c.accentDim : c.raised }}>
            <Icon name={v > 0 ? (rating === v ? "thumbs-up" : "thumbs-up-outline") : (rating === v ? "thumbs-down" : "thumbs-down-outline")}
                  size={18} color={rating === v ? c.accent : c.fg} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {clip.quality ? <Tag>{clip.quality >= 1440 ? "2K" : `${clip.quality}p`}</Tag> : null}
        {clip.moment != null && <Tag>{L("момент на", "moment at")} {time(clip.moment)}</Tag>}
        {clip.stream_at != null && <Tag>{clip.source_id ? L("видео", "video", "видео") : L("эфир", "stream", "эфир")} {streamClock(clip.stream_at)}</Tag>}
      </View>
      {(clip.quote || clip.signals?.length) ? (
        <View style={{ backgroundColor: c.raised, borderRadius: 12, padding: 12, gap: 6, marginTop: 10 }}>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Icon name="sparkles" size={14} color={c.accent} />
            <P style={{ fontSize: 13, fontWeight: "700" }}>{L("Почему AI выбрал этот момент", "Why AI picked this moment", "AI неге таңдады")}</P>
          </View>
          {clip.quote ? <P style={{ fontSize: 14, fontStyle: "italic" }}>«{clip.quote}»</P> : null}
          <P dim style={{ fontSize: 12 }}>{[clip.speaker, clip.emotion, ...(clip.signals ?? [])].filter(Boolean).join(" · ")}</P>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Button style={{ flex: 1 }} kind="outline" icon="download-outline" title={L("Скачать", "Save")} busy={saving} onPress={save} />
        <Button style={{ flex: 1 }} kind="outline" icon="share-outline" title={L("Поделиться", "Share")} onPress={() => Share.share({ url, message: url })} />
      </View>
      <Button style={{ marginTop: 10 }} icon="cut-outline" title={L("Монтаж", "Edit")} onPress={onEdit} />
      <View style={{ flex: 0.01 }} />
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
    // по источнику: стримы, видео (файл и ссылка), встречи
    const kinds = [{ id: "k:live", title: L("Стримы", "Streams", "Стримдер") }];
    if (clips.some((x) => x.source_kind === "upload" || x.source_kind === "url" || x.source_kind === "event")) kinds.push({ id: "k:video", title: L("Видео", "Videos", "Видео") });
    if (clips.some((x) => x.source_kind === "meeting")) kinds.push({ id: "k:meeting", title: L("Встречи", "Meetings", "Кездесулер") });
    return [{ id: "all", title: L("Все", "All") }, { id: "fav", title: L("Любимые", "Favorites") }, ...(kinds.length > 1 ? kinds : []), ...keys];
  }, [clips]);
  const kindOf = (x: Clip) => (!x.source_kind || x.source_kind === "live" ? "live" : x.source_kind === "meeting" ? "meeting" : "video");
  const shown = filter === "all" ? clips : filter === "fav" ? clips.filter((x) => x.fav)
    : filter.startsWith("k:") ? clips.filter((x) => kindOf(x) === filter.slice(2)) : clips.filter((x) => x.channel_key === filter);

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
        contentContainerStyle={{ gap: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <View style={s.row}>
              <H1>{L("Клипы", "Clips")}</H1>
              {fresh > 0 && <Tag>+{fresh} {L("НОВЫХ", "NEW")}</Tag>}
            </View>
            {clips.length > 0 && <Chips items={channels} value={filter} onChange={setFilter} />}
            {clips.length > 0 && (
              <P dim style={{ fontSize: 12 }}>
                {L("Веди пальцем по превью, чтобы посмотреть клип без открытия.", "Slide your finger over a preview to skim the clip.",
                   "Клипті ашпай көру үшін превью бойымен саусақпен жүргіз.")}
              </P>
            )}
            {moments.length > 0 && (
              <Pressable onPress={() => setReelOpen(true)}
                         style={[s.card, s.row, { borderColor: c.accent, backgroundColor: c.accentDim, paddingVertical: 12 }]}>
                <P style={{ fontWeight: "700" }}>{L("Хайлайты", "Highlights")}: {moments.length}</P>
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
          <Pressable onPress={() => !justScrubbed() && setOpen(item)} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ width: "48%" }}>
              <Scrub clip={item}>
                <View style={{ position: "absolute", top: 6, left: 6, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 6 }}>
                  <Tag>{shortReason(item)}</Tag>
                </View>
                <View style={{ position: "absolute", right: 6, bottom: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                  <P style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{time(item.source_duration ?? item.duration)}</P>
                </View>
              </Scrub>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <P style={{ fontWeight: "700", fontSize: 14, lineHeight: 18 }} numberOfLines={2}>{item.title ?? item.channel}</P>
              <P dim style={{ fontSize: 12 }} numberOfLines={1}>{item.channel} · {item.platform_title}</P>
              {item.stream_at != null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon name={item.source_id ? "play-circle-outline" : "radio-outline"} size={13} color={c.accent} />
                  <P style={{ fontSize: 12, color: c.accent, fontWeight: "600" }} numberOfLines={1}>
                    {item.source_id
                      ? `${L("на", "at", "видеоның")} ${streamClock(item.stream_at)} ${L("видео", "of the video", "сәтінде")}${item.speaker ? ` · ${item.speaker}` : ""}`
                      : `${L("на", "at", "эфирдің")} ${streamClock(item.stream_at)} ${L("эфира", "of the stream", "сәтінде")}`}
                  </P>
                </View>
              )}
              <P dim style={{ fontSize: 12 }} numberOfLines={1}>
                {new Date(item.created * 1000).toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </P>
              <View style={{ flexDirection: "row", gap: 14, marginTop: "auto" }}>
                <Pressable onPress={() => toggleFav(item)} hitSlop={8}>
                  <Icon name={item.fav ? "heart" : "heart-outline"} size={20} color={item.fav ? "#FF4D6D" : c.dim} />
                </Pressable>
                <Pressable onPress={() => setEditing(item)} hitSlop={8}>
                  <Icon name="cut-outline" size={20} color={c.dim} />
                </Pressable>
              </View>
            </View>
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
