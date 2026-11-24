import * as Sentry from "@sentry/react-native";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from "react-native";
import { api, loadToken, Me, setToken } from "./src/api";
import { onNotificationTap, registerPush } from "./src/push";
import Account from "./src/screens/Account";
import Channels from "./src/screens/Channels";
import Clips from "./src/screens/Clips";
import Feed from "./src/screens/Feed";
import Home from "./src/screens/Home";
import Login from "./src/screens/Login";
import Montage from "./src/screens/Montage";
import Plans from "./src/screens/Plans";
import Telegram from "./src/screens/Telegram";
import { SENTRY_DSN } from "./src/config";
import { c, FONT, Icon, ICON_FONT, IconName, setFontsReady, withFont } from "./src/ui";
import { loadSettings } from "./src/settings";
import { useFonts } from "expo-font";
// только нужные толщины, чтобы приложение было легче
import { Exo2_400Regular } from "@expo-google-fonts/exo-2/400Regular";
import { Exo2_500Medium } from "@expo-google-fonts/exo-2/500Medium";
import { Exo2_600SemiBold } from "@expo-google-fonts/exo-2/600SemiBold";
import { Exo2_700Bold } from "@expo-google-fonts/exo-2/700Bold";
import { Exo2_800ExtraBold } from "@expo-google-fonts/exo-2/800ExtraBold";
import { Exo2_900Black } from "@expo-google-fonts/exo-2/900Black";

if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1, sendDefaultPii: false });
import { L } from "./src/i18n";

type Tab = "home" | "clips" | "channels" | "feed" | "montage" | "account" | "plans";
// тарифы открываются из профиля, отдельной вкладки у них нет
const tabs = (): [Tab, string, IconName][] => [
  ["home", L("Эфир", "Live", "Эфир"), "radio-outline"],
  ["clips", L("Клипы", "Clips"), "film-outline"],
  ["montage", L("Монтаж", "Studio"), "cut-outline"],
  ["feed", L("Сообщество", "Community", "Қауымдастық"), "people-outline"],
  ["account", L("Профиль", "Profile"), "person-circle-outline"],
];

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [linking, setLinking] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [look, setLook] = useState(0); // меняется при смене темы или языка: перерисовываем всё
  const [fonts] = useFonts({
    [FONT.regular]: Exo2_400Regular, [FONT.medium]: Exo2_500Medium, [FONT.semibold]: Exo2_600SemiBold,
    [FONT.bold]: Exo2_700Bold, [FONT.heading]: Exo2_800ExtraBold, [FONT.headingBlack]: Exo2_900Black,
    ...ICON_FONT,
  });
  setFontsReady(fonts);

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
      await loadSettings();
      setLook((n) => n + 1);
      if (await loadToken()) await refresh();
      setLoading(false);
    })();
  }, []);

  // уведомления включаем, когда человек вошёл
  useEffect(() => {
    if (me) registerPush();
  }, [me?.id]);
  useEffect(() => onNotificationTap((data) => setTab(data.channel && !data.clip ? "home" : "clips")), []);

  let body: React.ReactNode;
  if (loading || !fonts) {
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
        <View style={{ flex: 1, ...(tab === "feed" ? null : { paddingHorizontal: 16, paddingTop: 16 }) }}>
          {tab === "home" && <Home me={me} onChange={refresh} onUpgrade={() => setTab("plans")} onClips={() => setTab("clips")} />}
          {tab === "clips" && <Clips me={me} />}
          {tab === "channels" && <Channels me={me} onChange={refresh} onUpgrade={() => setTab("plans")} />}
          {tab === "feed" && <Feed />}
          {tab === "montage" && <Montage me={me} />}
          {tab === "plans" && <Plans me={me} onChange={refresh} onBack={() => setTab("account")} />}
          {tab === "account" && <Account me={me} onLogout={() => setMe(null)} onTelegram={() => setLinking(true)}
                                         onPlans={() => setTab("plans")} onLook={() => setLook((n) => n + 1)} />}
        </View>
        <View style={{ flexDirection: "row", paddingTop: 8, paddingBottom: 6, borderTopWidth: 1, borderTopColor: c.line,
                       backgroundColor: c.bg }}>
          {tabs().map(([id, title, icon]) => {
            const on = tab === id || (tab === "plans" && id === "account") || (tab === "channels" && id === "home");
            return (
              <Pressable key={id} onPress={() => { setTab(id); refresh(); }}
                         style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, height: 48 }}>
                <Icon name={on ? (icon.replace("-outline", "") as IconName) : icon} size={23} color={on ? c.fg : c.dim} />
                <Text numberOfLines={1} style={withFont({ color: on ? c.fg : c.dim, fontWeight: on ? "600" : "500", fontSize: 11 })}>{title}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView key={look} style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={c.dark ? "light" : "dark"} />
      {body}
    </SafeAreaView>
  );
}

export default SENTRY_DSN ? Sentry.wrap(App) : App;
