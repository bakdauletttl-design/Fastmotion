import React from "react";
import { Alert, ScrollView, View } from "react-native";
import { api, Me, setToken } from "../api";
import { Button, c, H1, P, s, Tag } from "../ui";
import { L, LOCALE } from "../i18n";

// полоска «потрачено из лимита»
function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const part = limit ? Math.min(used / limit, 1) : 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <P dim style={{ fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{label}</P>
        <P style={{ fontSize: 14, fontWeight: "700" }}>{used}{limit ? ` ${L("из", "of")} ${limit}` : ""}</P>
      </View>
      {limit ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.line, overflow: "hidden" }}>
          <View style={{ width: `${part * 100}%`, height: 6, backgroundColor: part >= 1 ? c.danger : c.accent }} />
        </View>
      ) : null}
    </View>
  );
}

export default function Account({ me, onLogout, onTelegram, onPlans }:
  { me: Me; onLogout: () => void; onTelegram: () => void; onPlans: () => void }) {
  const until = me.plan_until ? new Date(me.plan_until * 1000).toLocaleDateString(LOCALE) : "—";
  const days = me.plan_until ? Math.max(0, Math.ceil((me.plan_until - Date.now() / 1000) / 86400)) : 0;
  const u = me.usage;
  const live = me.channels.filter((x) => x.live);

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
    ["Telegram", me.telegram_linked ? `@${me.telegram_username ?? L("подключён", "connected")}` : L("не подключён", "not connected")],
  ];
  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <H1>{L("Профиль", "Profile")}</H1>
      <View style={[s.card, { gap: 14, borderColor: c.accent }]}>
        <View style={s.row}>
          <View>
            <P dim style={{ fontSize: 13 }}>{L("Твой тариф", "Your plan")}</P>
            <P style={{ fontSize: 22, fontWeight: "800" }}>{me.plan?.title ?? L("Нет подписки", "No plan")}</P>
          </View>
          {me.plan && <Tag>{days} {L("дн. осталось", "days left")}</Tag>}
        </View>
        {me.plan && (
          <>
            <Meter label={L("Каналы", "Channels")} used={u?.channels ?? me.channels.length} limit={me.plan.channels} />
            {live.map((x) => (
              <Meter key={x.key} label={`● ${x.display ?? x.name}: ${L("клипы за этот стрим", "clips this stream")}`}
                     used={x.my_clips_stream ?? 0} limit={me.plan?.clips_per_stream ?? null} />
            ))}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {([[L("сегодня", "today"), u?.clips_today], [L("за 30 дней", "in 30 days"), u?.clips_month],
                 [L("своих", "my own"), u?.my_clips_month]] as [string, number | undefined][]).map(([k, v]) => (
                <View key={k} style={{ flex: 1, backgroundColor: c.bg, borderRadius: 12, padding: 10 }}>
                  <P style={{ fontSize: 20, fontWeight: "800" }}>{v ?? 0}</P>
                  <P dim style={{ fontSize: 12 }}>{L("клипов", "clips")} {k}</P>
                </View>
              ))}
            </View>
            <P dim style={{ fontSize: 12 }}>
              {me.plan.height >= 1440 ? "2K" : `${me.plan.height}p`} · {L("клип до", "clips up to")} {String(me.plan.max_seconds / 60).replace(".", ",")} {L("мин", "min")} · {L("до", "until")} {until}
            </P>
          </>
        )}
        <Button title={me.plan?.id === "max" ? L("Тарифы", "Plans") : L("Тарифы и повышение", "Plans and upgrade")} onPress={onPlans} />
      </View>
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
    </ScrollView>
  );
}
