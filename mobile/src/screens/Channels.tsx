import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, TextInput, View } from "react-native";
import { api, Channel, Found, Me, PlatformId } from "../api";
import Live from "./Live";
import { Button, c, Chips, H1, P, PLATFORMS, platformColor, s } from "../ui";
import { L } from "../i18n";

function Avatar({ name, platform, uri, size = 40 }: { name: string; platform: PlatformId; uri?: string | null; size?: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: platformColor(platform),
                   alignItems: "center", justifyContent: "center" }}>
      <P style={{ color: c.onAccent, fontWeight: "800" }}>{name.replace("@", "").charAt(0).toUpperCase()}</P>
    </View>
  );
}

export default function Channels({ me, onChange, onUpgrade }: { me: Me; onChange: () => void; onUpgrade: () => void }) {
  const [platform, setPlatform] = useState<PlatformId>("twitch");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [popular, setPopular] = useState<Found[]>([]);
  const [watching, setWatching] = useState<Channel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = me.plan?.channels ?? 0;
  const hint = PLATFORMS.find((p) => p.id === platform)?.hint ?? "";
  const following = new Set(me.channels.map((x) => x.key));

  useEffect(() => {
    api.popular().then(setPopular).catch(() => null);
  }, []);

  // поиск по мере набора (пока только Twitch отдаёт подсказки)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = text.trim();
    if (q.length < 2 || q.includes("/") || platform !== "twitch") {
      setFound([]);
      return;
    }
    timer.current = setTimeout(() => {
      api.search(q, platform).then(setFound).catch(() => setFound([]));
    }, 350);
  }, [text, platform]);

  async function add(channel: string, p: PlatformId = platform) {
    if (!channel.trim()) return;
    setBusy(channel);
    try {
      await api.addChannel(channel, p);
      setText("");
      setFound([]);
      onChange();
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 402) {
        Alert.alert(e.message, L("Можно повысить тариф", "You can upgrade your plan"), [
          { text: L("Отмена", "Cancel"), style: "cancel" },
          { text: L("Тарифы", "Plans"), onPress: onUpgrade },
        ]);
      } else Alert.alert(L("Ошибка", "Error"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function unfollow(key: string) {
    await api.removeChannel(key).catch(() => null);
    onChange();
  }

  const full = limit > 0 && me.channels.length >= limit && me.plan?.id !== "max";
  const suggestions = popular.filter((x) => x.key && !following.has(x.key));

  const foundRow = (item: Found, i: number) => (
    <Pressable key={`${item.platform}:${item.name}:${i}`} onPress={() => add(item.name, item.platform)}
               style={[s.row, { paddingVertical: 8, gap: 12 }]}>
      <Avatar name={item.name} platform={item.platform} uri={item.avatar} size={36} />
      <View style={{ flex: 1 }}>
        <P style={{ fontWeight: "700" }} numberOfLines={1}>{item.display ?? item.title ?? item.name}</P>
        <P dim style={{ fontSize: 12 }} numberOfLines={1}>
          {[item.live === true ? "● LIVE" : item.live === false ? L("офлайн", "offline") : null, item.game].filter(Boolean).join(" · ")}
        </P>
      </View>
      <Button title={busy === item.name ? "…" : "+"} kind="outline" onPress={() => add(item.name, item.platform)} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={me.channels}
        keyExtractor={(x) => x.key}
        contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <H1>{L("Каналы", "Channels")}</H1>
            <P dim>
              {L(
                "Любой стример с Twitch, YouTube, Kick, VK Видео или TikTok. Пока он в эфире, HypeCut смотрит стрим за тебя.",
                "Any streamer from Twitch, YouTube, Kick, VK Video or TikTok. While they are live, HypeCut watches for you.",
              )}
            </P>
            <Chips items={PLATFORMS.map((p) => ({ id: p.id, title: p.title }))} value={platform} onChange={setPlatform} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                style={[s.input, { flex: 1, minWidth: 0, borderRadius: 999 }]}
                placeholder={platform === "twitch" ? L("Начни вводить ник", "Start typing a name") : hint}
                placeholderTextColor={c.dim}
                autoCapitalize="none"
                autoCorrect={false}
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => add(text)}
              />
              <Button title={L("Добавить", "Add")} onPress={() => add(text)} busy={busy === text && !!text} />
            </View>
            {found.length > 0 && <View style={[s.card, { paddingVertical: 6 }]}>{found.slice(0, 6).map(foundRow)}</View>}
            <P dim style={{ fontSize: 13 }}>
              {me.channels.length} {L("из", "of")} {limit} · {me.plan?.title ?? "—"}
            </P>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[s.card, s.row, { paddingVertical: 12 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
              <View>
                <Avatar name={item.name} platform={item.platform} uri={item.avatar} />
                {item.live && (
                  <View style={{ position: "absolute", right: -2, bottom: -2, width: 14, height: 14, borderRadius: 7,
                                 backgroundColor: c.danger, borderWidth: 2, borderColor: c.card }} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: "700" }} numberOfLines={1}>{item.display ?? item.name.replace(/^@/, "")}</P>
                {item.live ? (
                  <P style={{ color: c.danger, fontSize: 12, fontWeight: "800" }}>
                    ● LIVE · {item.platform_title} · {item.clips_recent} {L("клипов", "clips")}
                  </P>
                ) : (
                  <P dim style={{ fontSize: 12 }}>{item.platform_title} · {L("офлайн, ждём эфир", "offline, waiting")}</P>
                )}
              </View>
            </View>
            {item.live && <Button title={L("▶ Эфир", "▶ Live")} kind="outline" style={{ height: 38, paddingHorizontal: 12 }}
                                  onPress={() => setWatching(item)} />}
            <Button title={item.live ? "✕" : L("Убрать", "Remove")} kind="text" onPress={() => unfollow(item.key)} />
          </View>
        )}
        ListFooterComponent={
          <View style={{ gap: 10, marginTop: 4 }}>
            {full && (
              <Pressable onPress={onUpgrade}
                         style={[s.card, { borderColor: c.accent, backgroundColor: c.accentDim }]}>
                <P style={{ fontWeight: "700" }}>{L("Нужно больше каналов?", "Need more channels?")}</P>
                <P dim style={{ fontSize: 13 }}>{me.plan?.id === "pro"
                  ? L("На Max до 10 стримеров, качество до 2K и клипы длиннее", "Max: up to 10 streamers, up to 2K and longer clips")
                  : L("На Pro до 6 стримеров и клипы в 1080p", "Pro: up to 6 streamers and 1080p clips")}</P>
              </Pressable>
            )}
            {!full && suggestions.length > 0 && (
              <View style={[s.card, { paddingVertical: 10 }]}>
                <P style={{ fontWeight: "700", marginBottom: 4 }}>{L("Популярные стримеры", "Popular streamers")}</P>
                {suggestions.slice(0, 8).map((x, i) =>
                  foundRow({ ...x, title: x.display ?? x.name.replace(/^@/, ""),
                             game: x.platform_title ?? null, live: undefined }, i))}
              </View>
            )}
          </View>
        }
      />
      <Modal visible={!!watching} animationType="slide" onRequestClose={() => setWatching(null)}>
        {watching && <Live channel={watching} me={me} onClose={() => { setWatching(null); onChange(); }} />}
      </Modal>
    </View>
  );
}
