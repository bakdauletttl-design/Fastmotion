import React from "react";
import { Alert, View } from "react-native";
import { api, Me, setToken } from "../api";
import { Button, H1, P, s } from "../ui";
import { L, LOCALE } from "../i18n";

export default function Account({ me, onLogout, onTelegram }: { me: Me; onLogout: () => void; onTelegram: () => void }) {
  const until = me.plan_until ? new Date(me.plan_until * 1000).toLocaleDateString(LOCALE) : "—";

  function logout() {
    setToken(null).then(onLogout);
  }

  // Apple требует, чтобы аккаунт можно было удалить прямо из приложения
  function deleteAccount() {
    Alert.alert(L("Удалить аккаунт?", "Delete account?"), L("Каналы и клипы будут удалены. Это нельзя отменить.", "Your channels and clips will be deleted. This cannot be undone."), [
      { text: L("Отмена", "Cancel"), style: "cancel" },
      {
        text: L("Удалить", "Delete"),
        style: "destructive",
        onPress: async () => {
          await api.deleteMe().catch(() => null);
          logout();
        },
      },
    ]);
  }

  const rows: [string, string][] = [
    [L("Аккаунт", "Account"), me.email ?? me.name ?? me.provider],
    [L("Тариф", "Plan"), `${me.plan?.title ?? L("нет", "none")} · ${L("до", "until")} ${until}`],
    ["Telegram", me.telegram_linked ? `@${me.telegram_username ?? L("подключён", "connected")}` : L("не подключён", "not connected")],
  ];
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <H1>{L("Профиль", "Profile")}</H1>
      <View style={[s.card, { gap: 14 }]}>
        {rows.map(([k, v]) => (
          <View key={k} style={s.row}>
            <P dim>{k}</P>
            <P style={{ fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{v}</P>
          </View>
        ))}
      </View>
      <Button title={me.telegram_linked ? L("Подключить другой Telegram", "Connect another Telegram") : L("Подключить Telegram", "Connect Telegram")}
              kind="outline" onPress={onTelegram} />
      <Button title={L("Выйти", "Log out")} kind="outline" onPress={logout} />
      <Button title={L("Удалить аккаунт", "Delete account")} kind="text" onPress={deleteAccount} />
      <P dim style={{ fontSize: 12, textAlign: "center" }}>
        {L(
          "HypeCut только нарезает моменты. Публикуя клипы, соблюдайте правила площадок и права стримеров.",
          "HypeCut only cuts moments. When you publish clips, follow platform rules and respect streamers’ rights.",
        )}
      </P>
    </View>
  );
}
