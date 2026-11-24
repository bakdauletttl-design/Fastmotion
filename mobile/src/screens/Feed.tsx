// Лента HypeCut, как в TikTok: листаешь вверх-вниз, ролики людей с их клипами стримов.
// Лайк, комментарии, подписка на автора, поделиться. Свои ролики выкладываются кнопкой «+».
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View,
} from "react-native";
import { api, Clipper, Comment, Post, withToken } from "../api";
import { L } from "../i18n";
import { useProjects } from "../project";
import { Button, c, Icon, IconName, P, s, withFont } from "../ui";

type Kind = "following" | "foryou" | "mine" | "top";
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)).replace(".0", "");
const ago = (t: number) => {
  const m = Math.max(1, Math.round((Date.now() / 1000 - t) / 60));
  return m < 60 ? L(`${m} мин`, `${m}m`) : m < 1440 ? L(`${Math.round(m / 60)} ч`, `${Math.round(m / 60)}h`) : L(`${Math.round(m / 1440)} дн`, `${Math.round(m / 1440)}d`);
};
const shadow = { textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 } as const;

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const hue = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue},55%,45%)`, alignItems: "center", justifyContent: "center",
                   borderWidth: 2, borderColor: "#fff" }}>
      <Text style={withFont({ color: "#fff", fontWeight: "800", fontSize: size * 0.4 })}>{name[0]?.toUpperCase()}</Text>
    </View>
  );
}

function Side({ icon, label, color = "#fff", onPress, testID }: { icon: IconName; label?: string; color?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} testID={testID} style={{ alignItems: "center", gap: 2 }}>
      <Icon name={icon} size={34} color={color} />
      {label != null && <Text style={withFont({ color: "#fff", fontSize: 12, fontWeight: "700", ...shadow })}>{label}</Text>}
    </Pressable>
  );
}

/** Один ролик на весь экран. Играет, только когда он перед глазами. */
function Item({ post, h, active, muted, onMute, onLike, onFollow, onComments, onReport }:
  { post: Post; h: number; active: boolean; muted: boolean; onMute: () => void;
    onLike: () => void; onFollow: () => void; onComments: () => void; onReport: () => void }) {
  const player = useVideoPlayer(withToken(post.video), (p) => { p.loop = true; p.muted = true; });
  const [paused, setPaused] = useState(false);
  const [heart, setHeart] = useState(false);
  const lastTap = useRef(0);
  useEffect(() => { player.muted = muted; }, [muted, player]);
  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
    if (!active) { player.currentTime = 0; setPaused(false); }
  }, [active, paused, player]);

  function tap() {
    const now = Date.now();
    if (now - lastTap.current < 300) { // двойное касание — лайк, как в TikTok
      if (!post.liked) onLike();
      setHeart(true);
      setTimeout(() => setHeart(false), 700);
      setPaused(false);
    } else setTimeout(() => { if (Date.now() - lastTap.current >= 300) setPaused((x) => !x); }, 310);
    lastTap.current = now;
  }

  return (
    <View style={{ height: h, backgroundColor: "#000" }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} playsInline />
      <Pressable onPress={tap} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        {paused && <Icon name="play" size={72} color="rgba(255,255,255,0.7)" />}
        {heart && <Icon name="heart" size={110} color="#FF2D55" />}
      </Pressable>

      <View style={{ position: "absolute", right: 10, bottom: 90, alignItems: "center", gap: 20 }}>
        <Pressable onPress={onFollow} style={{ alignItems: "center", marginBottom: 6 }}>
          <Avatar name={post.author.name} />
          {!post.mine && (
            <View style={{ position: "absolute", bottom: -9, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center",
                           backgroundColor: post.author.followed ? "#fff" : "#FF2D55" }}>
              <Icon name={post.author.followed ? "checkmark" : "add"} size={14} color={post.author.followed ? "#FF2D55" : "#fff"} />
            </View>
          )}
        </Pressable>
        <Side icon="heart" color={post.liked ? "#FF2D55" : "#fff"} label={short(post.likes)} onPress={onLike} />
        <Side icon="chatbubble-ellipses" label={short(post.comments)} onPress={onComments} />
        <Side icon="arrow-redo" label={short(post.shares)} onPress={() => Share.share({ message: `${post.caption} — HypeCut`, url: post.video })} />
        <Side icon={muted ? "volume-mute" : "volume-high"} onPress={onMute} />
        {!post.mine && <Side icon="flag-outline" onPress={onReport} testID="report" />}
      </View>

      <View pointerEvents="box-none" style={{ position: "absolute", left: 14, right: 80, bottom: 22, gap: 6 }}>
        <Text style={withFont({ color: "#fff", fontWeight: "800", fontSize: 16, ...shadow })}>
          @{post.author.name} <Text style={{ fontWeight: "500", fontSize: 13, color: "rgba(255,255,255,0.75)" }}>· {ago(post.created)}</Text>
        </Text>
        {!!post.caption && <Text numberOfLines={3} style={withFont({ color: "#fff", fontSize: 14, ...shadow })}>{post.caption}</Text>}
        {(post.credit || post.channel) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.45)",
                         borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Icon name={post.own ? "person-circle-outline" : "radio"} size={13} color="#fff" />
            <Text style={withFont({ color: "#fff", fontSize: 12, fontWeight: "600" })}>
              {post.own ? L("Своё видео", "Own video", "Өз видеосы")
                        : `${L("Оригинал", "Original", "Түпнұсқа")}: ${post.credit || post.channel}${post.platform ? ` · ${post.platform[0].toUpperCase()}${post.platform.slice(1)}` : ""}`}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Комментарии снизу, как шторка. */
function Comments({ post, onClose, onAdded }: { post: Post; onClose: () => void; onAdded: () => void }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  useEffect(() => { api.comments(post.id).then(setList).catch(() => setList([])); }, [post.id]);
  async function send() {
    if (!text.trim()) return;
    const x = await api.comment(post.id, text.trim()).catch(() => null);
    if (x) { setList((l) => [x, ...(l ?? [])]); setText(""); onAdded(); }
  }
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={{ height: "62%", backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12 }}>
        <View style={[s.row, { paddingHorizontal: 16, height: 32 }]}>
          <View style={{ width: 26 }} />
          <P style={{ fontWeight: "700" }}>{short(post.comments)} {L("комментариев", "comments", "пікір")}</P>
          <Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={24} /></Pressable>
        </View>
        {!list ? <ActivityIndicator color={c.accent} style={{ marginTop: 20 }} /> : (
          <FlatList data={list} keyExtractor={(x) => x.id} contentContainerStyle={{ padding: 16, gap: 16 }}
                    renderItem={({ item }) => (
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <Avatar name={item.author} size={34} />
                        <View style={{ flex: 1 }}>
                          <P dim style={{ fontSize: 12 }}>{item.author} · {ago(item.created)}</P>
                          <P style={{ fontSize: 14 }}>{item.text}</P>
                        </View>
                        <View style={{ alignItems: "center" }}>
                          <Icon name="heart-outline" size={16} color={c.dim} />
                          <P dim style={{ fontSize: 11 }}>{item.likes}</P>
                        </View>
                      </View>
                    )} />
        )}
        <View style={{ flexDirection: "row", gap: 8, padding: 12, paddingBottom: Platform.OS === "web" ? 12 : 28, borderTopWidth: 1, borderTopColor: c.line }}>
          <TextInput style={[s.input, { flex: 1, height: 44 }]} value={text} onChangeText={setText} maxLength={300} onSubmitEditing={send}
                     placeholder={L("Добавить комментарий…", "Add a comment…", "Пікір қосу…")} placeholderTextColor={c.dim} />
          <Pressable onPress={send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
            <Icon name="arrow-up" size={20} color={c.onAccent} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Пожаловаться, как в TikTok. Жалоба правообладателя скрывает ролик сразу, до проверки. */
const REASONS = () => [
  { id: "rights", icon: "shield-checkmark-outline" as IconName, t: L("Это мой контент, я не давал разрешения", "This is my content, I did not allow it", "Бұл менің контентім, рұқсат бермедім") },
  { id: "credit", icon: "person-outline" as IconName, t: L("Не указан автор оригинала", "Original creator not credited", "Түпнұсқа авторы көрсетілмеген") },
  { id: "abuse", icon: "hand-left-outline" as IconName, t: L("Травля или оскорбления", "Harassment or insults", "Қорлау") },
  { id: "nsfw", icon: "eye-off-outline" as IconName, t: L("18+ или насилие", "Adult content or violence", "18+ немесе зорлық") },
  { id: "spam", icon: "alert-circle-outline" as IconName, t: L("Спам или обман", "Spam or scam", "Спам немесе алаяқтық") },
];

function Report({ post, onClose, onHidden }: { post: Post; onClose: () => void; onHidden: () => void }) {
  const [done, setDone] = useState<string | null>(null);
  async function send(reason: string) {
    await api.report(post.id, reason).catch(() => null);
    setDone(reason);
    if (reason === "rights") onHidden();
  }
  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={{ backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 30, gap: 10 }}>
        <View style={s.row}>
          <P style={{ fontWeight: "800", fontSize: 17 }}>{L("Пожаловаться", "Report", "Шағымдану")}</P>
          <Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={24} /></Pressable>
        </View>
        {done ? (
          <View style={{ gap: 8 }}>
            <Icon name="checkmark-circle" size={36} color={c.accent} />
            <P>{done === "rights"
              ? L("Ролик скрыт. Мы проверим, что контент ваш, и удалим его из ленты. Если вы стример, можно запретить нарезку вашего канала: Профиль → «Для стримеров».",
                  "The video is hidden. We will verify the content is yours and remove it. Streamers can also opt out: Profile → For streamers.")
              : L("Спасибо. Мы проверим ролик и удалим его, если он нарушает правила.", "Thanks. We will review it and remove it if it breaks the rules.")}</P>
            <Button title={L("Готово", "Done", "Дайын")} onPress={onClose} />
          </View>
        ) : REASONS().map((r) => (
          <Pressable key={r.id} onPress={() => send(r.id)} testID={`report-${r.id}`}
                     style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 10 }}>
            <Icon name={r.icon} size={22} color={r.id === "rights" ? c.accent : c.fg} />
            <P style={{ flex: 1 }}>{r.t}</P>
            <Icon name="chevron-forward" size={18} color={c.dim} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Выложить свой ролик: берём из экспортов в проектах. */
function Publish({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const saved = useProjects();
  const ready = saved.filter((p) => p.exports.length);
  const [pick, setPick] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState<"own" | "allowed" | null>(null);
  const [credit, setCredit] = useState("");
  const [agree, setAgree] = useState(false);
  const chosen = ready.find((x) => x.id === pick);
  useEffect(() => { // автор оригинала подставляется сам: канал, с которого клип
    const ch = chosen?.segs[0]?.clip.channel;
    if (ch && !ch.startsWith("src:")) setCredit(ch.replace(/^[a-z]+:/, ""));
  }, [chosen?.id]);
  const okRights = own === "own" || (own === "allowed" && credit.trim().length > 1);
  async function go() {
    const p = chosen;
    if (!p || !okRights || !agree) return;
    setBusy(true);
    try {
      await api.publish(p.exports[0].video, caption.trim(), p.segs[0]?.clip.id, { own: own === "own", credit: own === "own" ? null : credit.trim() });
      onDone();
    } catch (e: any) {
      Alert.alert(L("Не получилось", "Failed"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 16, paddingTop: Platform.OS === "web" ? 16 : 56, paddingBottom: 40, gap: 14 }}>
      <View style={s.row}>
        <P style={{ fontWeight: "700", fontSize: 18 }}>{L("Выложить в ленту", "Post to feed", "Таспаға салу")}</P>
        <Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={26} /></Pressable>
      </View>
      {ready.length === 0 ? (
        <P dim>{L("Сначала смонтируй и экспортируй ролик во вкладке «Монтаж». Готовые ролики появятся здесь.",
                  "First edit and export a video in the Editor tab. Ready videos will show up here.",
                  "Алдымен «Монтаж» бөлімінде роликті экспортта. Дайын роликтер осында шығады.")}</P>
      ) : (
        <>
          <P dim style={{ fontSize: 13 }}>{L("Выбери готовый ролик", "Pick a ready video", "Дайын роликті таңда")}</P>
          <FlatList horizontal data={ready} keyExtractor={(x) => x.id} contentContainerStyle={{ gap: 10 }} style={{ flexGrow: 0, flexShrink: 0, minHeight: 222 }}
                    renderItem={({ item }) => (
                      <Pressable onPress={() => setPick(item.id)} style={{ width: 110, gap: 4 }} testID={`pick-${item.id}`}>
                        <View style={{ aspectRatio: 9 / 16, borderRadius: 10, backgroundColor: c.raised, borderWidth: 2,
                                       borderColor: pick === item.id ? c.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
                          <Icon name={pick === item.id ? "checkmark-circle" : "film-outline"} size={28} color={pick === item.id ? c.accent : c.dim} />
                        </View>
                        <P numberOfLines={1} style={{ fontSize: 12 }}>{item.name}</P>
                      </Pressable>
                    )} />
          <TextInput style={[s.input, { height: 90, paddingTop: 12, textAlignVertical: "top" }]} multiline value={caption} onChangeText={setCaption} maxLength={300}
                     placeholder={L("Подпись и хэштеги, например #cs2", "Caption and hashtags, like #cs2", "Сипаттама мен хэштегтер")} placeholderTextColor={c.dim} />
          <P style={{ fontWeight: "700" }}>{L("Чьё это видео?", "Whose video is it?", "Бұл кімнің видеосы?")}</P>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {([["own", L("Моё", "Mine", "Менікі"), "person-circle-outline"], ["allowed", L("Чужое, автор разрешил", "Someone else's, allowed", "Басқанікі, рұқсат бар"), "people-outline"]] as const).map(([id, t, ic]) => (
              <Pressable key={id} onPress={() => setOwn(id)} testID={`own-${id}`}
                         style={{ flex: 1, borderRadius: 12, padding: 12, gap: 6, backgroundColor: c.raised, borderWidth: 2, borderColor: own === id ? c.accent : "transparent" }}>
                <Icon name={ic} size={22} color={own === id ? c.accent : c.dim} />
                <P style={{ fontSize: 13, fontWeight: "600" }}>{t}</P>
              </Pressable>
            ))}
          </View>
          {own === "allowed" && (
            <View style={{ gap: 6 }}>
              <TextInput style={s.input} value={credit} onChangeText={setCredit} maxLength={80} autoCapitalize="none" testID="credit"
                         placeholder={L("Автор оригинала: ник или канал", "Original creator: name or channel", "Түпнұсқа авторы")} placeholderTextColor={c.dim} />
              <P dim style={{ fontSize: 12 }}>{L("Автор будет подписан на ролике. Если он пожалуется, ролик удалят.",
                                                "The creator is credited on the video. If they complain, it will be removed.")}</P>
            </View>
          )}
          <Pressable onPress={() => setAgree(!agree)} testID="agree" style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: agree ? c.accent : c.dim, backgroundColor: agree ? c.accent : "transparent",
                           alignItems: "center", justifyContent: "center", marginTop: 1 }}>
              {agree && <Icon name="checkmark" size={15} color={c.onAccent} />}
            </View>
            <P style={{ fontSize: 13, flex: 1 }}>{L("У меня есть право выложить это видео, и я соблюдаю правила сообщества",
                                                   "I have the right to post this video and I follow the community rules",
                                                   "Бұл видеоны салуға құқығым бар, қауымдастық ережелерін сақтаймын")}</P>
          </Pressable>
          <Button icon="cloud-upload-outline" title={L("Выложить", "Post", "Жариялау")} busy={busy} disabled={!pick || !okRights || !agree} onPress={go} />
          <P dim style={{ fontSize: 11 }}>{L("Ролик увидят все в ленте HypeCut. Чужие ролики без разрешения автора удаляются по жалобе, а за повторные нарушения закрывается доступ.",
                                            "Everyone in the HypeCut feed will see it. Videos posted without the creator's permission are removed on complaint; repeat violators lose access.")}</P>
        </>
      )}
    </ScrollView>
  );
}

/** Рейтинг клипперов: кто чаще всех находит моменты командой !clip и чьи клипы принимают. */
function Top() {
  const [list, setList] = useState<Clipper[] | null>(null);
  useEffect(() => { api.clippers().then(setList).catch(() => setList([])); }, []);
  const medal = ["#FFD24A", "#C9D1D9", "#D9905A"];
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 52 }}>
      {!list ? <ActivityIndicator color={c.accent} /> : (
        <FlatList data={list} keyExtractor={(x) => x.name} contentContainerStyle={{ padding: 16, gap: 10 }}
                  ListHeaderComponent={
                    <View style={{ gap: 4, marginBottom: 6 }}>
                      <P style={{ fontWeight: "800", fontSize: 20 }}>{L("Лучшие клипперы", "Top clippers", "Үздік клипперлер")}</P>
                      <P dim style={{ fontSize: 13 }}>{L("Зрители пишут !clip в чате, когда случилось что-то яркое. Чьи моменты чаще принимают, тот выше.",
                                                        "Viewers type !clip in chat when something big happens. The more of your moments get approved, the higher you are.",
                                                        "Көрермендер чатқа !clip жазады. Сәттері жиі қабылданғандар жоғарыда.")}</P>
                    </View>
                  }
                  renderItem={({ item, index }) => (
                    <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }]}>
                      <View style={{ width: 28, alignItems: "center" }}>
                        {index < 3 ? <Icon name="trophy" size={22} color={medal[index]} /> : <P dim style={{ fontWeight: "800" }}>{index + 1}</P>}
                      </View>
                      <Avatar name={item.name} size={38} />
                      <View style={{ flex: 1 }}>
                        <P style={{ fontWeight: "700" }} numberOfLines={1}>@{item.name}</P>
                        <P dim style={{ fontSize: 12 }}>{item.clips} !clip · {L("принято", "approved", "қабылданды")} {item.approved}</P>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <P style={{ fontWeight: "800" }}>{short(item.views)}</P>
                        <P dim style={{ fontSize: 11 }}>{L("просмотров", "views", "қаралым")}</P>
                      </View>
                    </View>
                  )} />
      )}
    </View>
  );
}

export default function Feed() {
  const [kind, setKind] = useState<Kind>("foryou");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [h, setH] = useState(0);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(Platform.OS === "web"); // браузер не даёт сразу играть со звуком
  const [comments, setComments] = useState<Post | null>(null);
  const [posting, setPosting] = useState(false);
  const [reporting, setReporting] = useState<Post | null>(null);

  const load = useCallback(async (k: Kind) => {
    setPosts(null);
    setIndex(0);
    setPosts(await api.feed(k === "top" ? "foryou" : k).catch(() => []));
  }, []);
  useEffect(() => { if (kind !== "top") load(kind); }, [kind, load]);

  const patch = (id: string, f: (p: Post) => Post) => setPosts((l) => l?.map((x) => (x.id === id ? f(x) : x)) ?? null);
  function like(p: Post) {
    api.like(p.id, !p.liked).catch(() => null);
    patch(p.id, (x) => ({ ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) }));
  }
  function follow(p: Post) {
    if (p.mine) return;
    const on = !p.author.followed;
    api.follow(p.author.id, on).catch(() => null);
    setPosts((l) => l?.map((x) => (x.author.id === p.author.id ? { ...x, author: { ...x.author, followed: on } } : x)) ?? null);
  }

  const tabs: [Kind, string][] = [["following", L("Подписки", "Following", "Жазылым")], ["foryou", L("Для тебя", "For you", "Саған")],
                                  ["mine", L("Мои", "Mine", "Менікі")], ["top", L("Топ", "Top", "Үздік")]];
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {kind === "top" && <Top />}
      {kind !== "top" && posts && h > 0 && (
        posts.length ? (
          <FlatList
            data={posts} keyExtractor={(x) => x.id} pagingEnabled snapToInterval={h} decelerationRate="fast" showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })}
            onScroll={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.y / h))} scrollEventThrottle={50}
            renderItem={({ item, index: i }) => (
              <Item post={item} h={h} active={i === index && !comments && !posting && !reporting} muted={muted} onMute={() => setMuted((m) => !m)}
                    onLike={() => like(item)} onFollow={() => follow(item)} onComments={() => setComments(item)} onReport={() => setReporting(item)} />
            )}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
            <Icon name={kind === "mine" ? "film-outline" : "people-outline"} size={44} color="#777" />
            <Text style={withFont({ color: "#bbb", textAlign: "center", fontSize: 15 })}>
              {kind === "mine" ? L("Ты ещё ничего не выложил. Нажми «+» сверху.", "You haven't posted yet. Tap + at the top.", "Әлі ештеңе салмадың. Жоғарыдағы «+» бас.")
                               : L("Подпишись на авторов в ленте «Для тебя», и их ролики будут здесь.", "Follow creators in For you and their videos show up here.",
                                   "«Саған» таспасында авторларға жазыл, олардың роликтері осында болады.")}
            </Text>
          </View>
        )
      )}
      {kind !== "top" && !posts && <ActivityIndicator color="#fff" style={{ position: "absolute", top: "45%", alignSelf: "center" }} />}

      <View pointerEvents="box-none" style={{ position: "absolute", top: 8, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 14, paddingRight: 40 }}>
        {tabs.map(([id, t]) => (
          <Pressable key={id} onPress={() => setKind(id)} hitSlop={6} style={{ alignItems: "center", gap: 4 }}>
            <Text style={withFont({ color: kind === id ? (kind === "top" ? c.fg : "#fff") : kind === "top" ? c.dim : "rgba(255,255,255,0.6)", fontWeight: "700", fontSize: 15, ...shadow })}>{t}</Text>
            <View style={{ width: 24, height: 3, borderRadius: 2, backgroundColor: kind === id ? (kind === "top" ? c.fg : "#fff") : "transparent" }} />
          </Pressable>
        ))}
        <Pressable onPress={() => setPosting(true)} hitSlop={8} testID="post" style={{ position: "absolute", right: 14, top: 0 }}>
          <View style={{ width: 34, height: 26, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
            <Icon name="add" size={22} color="#000" />
          </View>
        </Pressable>
      </View>

      <Modal visible={!!comments} transparent animationType="slide" onRequestClose={() => setComments(null)}>
        {comments && <Comments post={comments} onClose={() => setComments(null)}
                               onAdded={() => patch(comments.id, (x) => ({ ...x, comments: x.comments + 1 }))} />}
      </Modal>
      <Modal visible={!!reporting} transparent animationType="slide" onRequestClose={() => setReporting(null)}>
        {reporting && <Report post={reporting} onClose={() => setReporting(null)}
                              onHidden={() => setPosts((l) => l?.filter((x) => x.id !== reporting.id) ?? null)} />}
      </Modal>
      <Modal visible={posting} animationType="slide" onRequestClose={() => setPosting(false)}>
        <Publish onClose={() => setPosting(false)} onDone={() => { setPosting(false); setKind("mine"); load("mine"); }} />
      </Modal>
    </View>
  );
}
