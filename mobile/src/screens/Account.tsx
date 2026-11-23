import React from "react";
import { Alert, View } from "react-native";
import { api, Me, setToken } from "../api";
import { Button, H1, P, s } from "../ui";

export default function Account({ me, onLogout, onTelegram }: { me: Me; onLogout: () => void; onTelegram: () => void }) {
  const until = me.plan_until ? new Date(me.plan_until * 1000).toLocaleDateString("ru-RU") : "—";

  function logout() {
    setToken(null).then(onLogout);
  }

  // Apple требует, чтобы аккаунт можно было удалить прямо из приложения
  function deleteAccount() {
    Alert.alert("Удалить аккаунт?", "Каналы и клипы будут удалены. Это нельзя отменить.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          await api.deleteMe().catch(() => null);
          logout();
        },
      },
    ]);
  }

  const rows: [string, string][] = [
    ["Аккаунт", me.email ?? me.name ?? me.provider],
    ["Тариф", `${me.plan?.title ?? "нет"} · до ${until}`],
    ["Telegram", me.telegram_linked ? `@${me.telegram_username ?? "подключён"}` : "не подключён"],
  ];
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <H1>Профиль</H1>
      <View style={[s.card, { gap: 14 }]}>
        {rows.map(([k, v]) => (
          <View key={k} style={s.row}>
            <P dim>{k}</P>
            <P style={{ fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{v}</P>
          </View>
        ))}
      </View>
      <Button title={me.telegram_linked ? "Подключить другой Telegram" : "Подключить Telegram"}
              kind="outline" onPress={onTelegram} />
      <Button title="Выйти" kind="outline" onPress={logout} />
      <Button title="Удалить аккаунт" kind="text" onPress={deleteAccount} />
      <P dim style={{ fontSize: 12, textAlign: "center" }}>
        HypeCut только нарезает моменты. Публикуя клипы, соблюдайте правила Twitch и права стримеров.
      </P>
    </View>
  );
}
