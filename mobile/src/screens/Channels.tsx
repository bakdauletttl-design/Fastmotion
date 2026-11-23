import React, { useState } from "react";
import { Alert, FlatList, TextInput, View } from "react-native";
import { api, Me } from "../api";
import { Button, c, H1, P, s } from "../ui";

export default function Channels({ me, onChange, onUpgrade }: { me: Me; onChange: () => void; onUpgrade: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const limit = me.plan?.channels ?? 0;

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addChannel(text);
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

  async function remove(ch: string) {
    await api.removeChannel(ch).catch(() => null);
    onChange();
  }

  return (
    <View style={{ flex: 1 }}>
      <H1>Каналы</H1>
      <P dim>Любой стример с Twitch. Пока он в эфире, HypeCut смотрит стрим за тебя.</P>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          placeholder="ник или twitch.tv/ссылка"
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
        keyExtractor={(x) => x}
        contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
        renderItem={({ item }) => (
          <View style={[s.card, s.row, { paddingVertical: 12 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
              <P style={{ fontWeight: "600" }}>{item}</P>
            </View>
            <Button title="Убрать" kind="text" onPress={() => remove(item)} />
          </View>
        )}
      />
    </View>
  );
}
