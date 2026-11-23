import * as Sentry from "@sentry/react-native";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from "react-native";
import { api, loadToken, Me, setToken } from "./src/api";
import { onNotificationTap, registerPush } from "./src/push";
import Account from "./src/screens/Account";
import Channels from "./src/screens/Channels";
import Clips from "./src/screens/Clips";
import Login from "./src/screens/Login";
import Montage from "./src/screens/Montage";
import Plans from "./src/screens/Plans";
import Telegram from "./src/screens/Telegram";
import { SENTRY_DSN } from "./src/config";
import { c } from "./src/ui";

if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1, sendDefaultPii: false });
import { L } from "./src/i18n";

type Tab = "clips" | "channels" | "montage" | "account" | "plans";
// тарифы открываются из профиля, отдельной вкладки у них нет
const TABS: [Tab, string][] = [
  ["clips", L("Клипы", "Clips")],
  ["channels", L("Каналы", "Channels")],
  ["montage", L("Монтаж", "Editor")],
  ["account", L("Профиль", "Profile")],
];

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("clips");
  const [linking, setLinking] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e: any) {
      if (e?.status === 401) {
        await setToken(null);
        setMe(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (await loadToken()) await refresh();
      setLoading(false);
    })();
  }, []);

  // уведомления включаем, когда человек вошёл
  useEffect(() => {
    if (me) registerPush();
  }, [me?.id]);
  useEffect(() => onNotificationTap((data) => setTab(data.channel && !data.clip ? "channels" : "clips")), []);

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  } else if (!me) {
    body = <Login onLogin={(u) => { setMe(u); setSkipped(false); }} />;
  } else if ((!me.telegram_linked && !skipped) || linking) {
    // сразу после регистрации ведём человека в нашего Telegram-бота
    body = (
      <Telegram
        me={me}
        onLinked={(u) => { setMe(u); setLinking(false); }}
        onSkip={() => { setSkipped(true); setLinking(false); }}
      />
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 24 }}>
          {tab === "clips" && <Clips me={me} />}
          {tab === "channels" && <Channels me={me} onChange={refresh} onUpgrade={() => setTab("plans")} />}
          {tab === "montage" && <Montage me={me} />}
          {tab === "plans" && <Plans me={me} onChange={refresh} onBack={() => setTab("account")} />}
          {tab === "account" && <Account me={me} onLogout={() => setMe(null)} onTelegram={() => setLinking(true)}
                                         onPlans={() => setTab("plans")} />}
        </View>
        <View style={{ flexDirection: "row", margin: 16, padding: 6, borderRadius: 999,
                       backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
          {TABS.map(([id, title]) => (
            <Pressable
              key={id}
              onPress={() => { setTab(id); refresh(); }}
              style={{ flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center",
                       backgroundColor: tab === id || (tab === "plans" && id === "account") ? c.accent : "transparent" }}
            >
              <Text style={{ color: tab === id || (tab === "plans" && id === "account") ? c.onAccent : c.dim, fontWeight: "700", fontSize: 13 }}>{title}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style="light" />
      {body}
    </SafeAreaView>
  );
}

export default SENTRY_DSN ? Sentry.wrap(App) : App;
