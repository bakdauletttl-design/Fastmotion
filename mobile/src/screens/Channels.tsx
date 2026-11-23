import React, { useState } from "react";
import { Alert, FlatList, Pressable, TextInput, View } from "react-native";
import { api, Me, PlatformId } from "../api";
import { Button, c, Chips, H1, P, PLATFORMS, platformColor, s } from "../ui";

export default function Channels({ me, onChange, onUpgrade }: { me: Me; onChange: () => void; onUpgrade: () => void }) {
  const [platform, setPlatform] = useState<PlatformId>("twitch");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const limit = me.plan?.channels ?? 0;
  const hint = PLATFORMS.find((p) => p.id === platform)?.hint ?? "";

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addChannel(text, platform);
      setText("");
      onChange();
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 402) {
        Alert.alert(e.message, "Можно повысить тариф", [
          { text: "Отмена", style: "cancel" },
          { text: "Тарифы", onPress: onUpgrade },
        ]);
      } else Alert.alert("Ошибка", String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function unfollow(key: string) {
    await api.removeChannel(key).catch(() => null);
    onChange();
  }

  const full = limit > 0 && me.channels.length >= limit && me.plan?.id !== "pro";

  return (
    <View style={{ flex: 1 }}>
      <H1>Каналы</H1>
      <P dim>Любой стример с Twitch, YouTube, Kick, VK Видео или TikTok. Пока он в эфире, HypeCut смотрит стрим за тебя.</P>
      <View style={{ marginTop: 16 }}>
        <Chips items={PLATFORMS.map((p) => ({ id: p.id, title: p.title }))} value={platform} onChange={setPlatform} />
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <TextInput
          style={[s.input, { flex: 1, borderRadius: 999 }]}
          placeholder={hint}
          placeholderTextColor={c.dim}
          autoCapitalize="none"
          autoCorrect={false}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
        />
        <Button title="Добавить" onPress={add} busy={busy} />
      </View>
      <P dim style={{ marginTop: 12, fontSize: 13 }}>
        {me.channels.length} из {limit} на тарифе {me.plan?.title ?? "—"}
      </P>
      <FlatList
        style={{ marginTop: 8 }}
        data={me.channels}
        keyExtractor={(x) => x.key}
        contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
        renderItem={({ item }) => (
          <View style={[s.card, s.row, { paddingVertical: 12 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: platformColor(item.platform),
                             alignItems: "center", justifyContent: "center" }}>
                <P style={{ color: c.onAccent, fontWeight: "800" }}>{item.name.replace("@", "").charAt(0).toUpperCase()}</P>
              </View>
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: "700" }} numberOfLines={1}>{item.name.replace(/^@/, "")}</P>
                {item.live ? (
                  <P style={{ color: c.danger, fontSize: 12, fontWeight: "800" }}>
                    ● LIVE · {item.platform_title} · {item.clips_recent} клипов
                  </P>
                ) : (
                  <P dim style={{ fontSize: 12 }}>{item.platform_title} · офлайн, ждём эфир</P>
                )}
              </View>
            </View>
            <Button title="Убрать" kind="text" onPress={() => unfollow(item.key)} />
          </View>
        )}
        ListFooterComponent={
          full ? (
            <Pressable onPress={onUpgrade}
                       style={[s.card, { marginTop: 4, borderColor: c.accent, backgroundColor: c.accentDim }]}>
              <P style={{ fontWeight: "700" }}>Нужно больше каналов?</P>
              <P dim style={{ fontSize: 13 }}>На Pro до 10 стримеров и клипы без лимита</P>
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}
