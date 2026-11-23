import React, { useEffect, useState } from "react";
import { Alert, AppState, Linking, View } from "react-native";
import { api, Me } from "../api";
import { Button, c, H1, P, Screen, s, Tag } from "../ui";
import { L } from "../i18n";

// Шаг сразу после входа: подключить нашего бота, чтобы клипы приходили в Telegram
export default function Telegram({ me, onLinked, onSkip }: { me: Me; onLinked: (me: Me) => void; onSkip?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // Когда человек возвращается из Telegram, проверяем, привязался ли аккаунт
  useEffect(() => {
    if (!waiting) return;
    const check = async () => {
      const fresh = await api.me().catch(() => null);
      if (fresh?.telegram_linked) onLinked(fresh);
    };
    const sub = AppState.addEventListener("change", (st) => st === "active" && check());
    const timer = setInterval(check, 3000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [waiting]);

  async function connect() {
    setBusy(true);
    try {
      const link = await api.telegramLink();
      // сначала пробуем открыть приложение Telegram напрямую, иначе ссылку t.me
      const opened = await Linking.openURL(link.app_url).then(() => true).catch(() => false);
      if (!opened) await Linking.openURL(link.url);
      setWaiting(true);
    } catch (e: any) {
      Alert.alert(L("Ошибка", "Error"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    L("Нажми кнопку ниже", "Tap the button below"),
    L("В Telegram нажми «Start»", "Press “Start” in Telegram"),
    L("Вернись сюда, всё подключится само", "Come back here, it connects automatically"),
  ];
  return (
    <Screen style={{ justifyContent: "space-between", paddingTop: 96, paddingBottom: 48 }}>
      <View>
        <Tag>{L("ШАГ 2 ИЗ 2", "STEP 2 OF 2")}</Tag>
        <H1 style={{ marginTop: 20 }}>{L("Подключи Telegram", "Connect Telegram")}</H1>
        <P dim>
          {L("Готовые клипы будут приходить от бота", "Ready clips will come from the bot")} @{me.bot_username || "HypeCut_bot"}.{" "}
          {L("Это бесплатно.", "It is free.")}
        </P>
        <View style={[s.card, { marginTop: 28, gap: 16 }]}>
          {steps.map((t, i) => (
            <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent,
                             alignItems: "center", justifyContent: "center" }}>
                <P style={{ color: c.onAccent, fontWeight: "800" }}>{i + 1}</P>
              </View>
              <P style={{ flex: 1 }}>{t}</P>
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        <Button title={waiting ? L("Открыть Telegram ещё раз", "Open Telegram again") : L("Открыть Telegram", "Open Telegram")} onPress={connect} busy={busy} />
        {waiting && <P dim style={{ textAlign: "center" }}>{L("Жду подтверждения от бота...", "Waiting for the bot...")}</P>}
        {onSkip && <Button title={L("Позже", "Later")} kind="text" onPress={onSkip} />}
      </View>
    </Screen>
  );
}
