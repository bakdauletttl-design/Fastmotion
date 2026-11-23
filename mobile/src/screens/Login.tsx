import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import React, { useEffect, useState } from "react";
import { Alert, Linking, Platform, View } from "react-native";
import { api, DEMO, Me, setToken } from "../api";
import { API_URL, DEV_LOGIN, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "../config";
import { Button, c, H1, P, Screen, Tag } from "../ui";
import { L } from "../i18n";

export default function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [apple, setApple] = useState(false);

  useEffect(() => {
    if (DEMO) return;
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID || undefined });
    if (Platform.OS === "ios") AppleAuthentication.isAvailableAsync().then(setApple);
  }, []);

  async function run(kind: string, fn: () => Promise<{ token: string; user: Me } | null>) {
    setBusy(kind);
    try {
      const res = await fn();
      if (res) {
        await setToken(res.token);
        onLogin(res.user);
      }
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED") Alert.alert(L("Не получилось войти", "Sign-in failed"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  const google = () =>
    run("google", async () => {
      await GoogleSignin.hasPlayServices();
      const r = await GoogleSignin.signIn();
      if (!isSuccessResponse(r) || !r.data.idToken) return null;
      return api.loginGoogle(r.data.idToken);
    });

  const signInApple = () =>
    run("apple", async () => {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) return null;
      const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(" ");
      return api.loginApple(cred.identityToken, name || undefined);
    });

  return (
    <Screen style={{ justifyContent: "space-between", paddingTop: 96, paddingBottom: 48 }}>
      <View>
        <Tag>STREAMS · AI CLIPS</Tag>
        <H1 style={{ fontSize: 56, marginTop: 20, lineHeight: 58 }}>
          Hype<H1 style={{ fontSize: 56, color: c.accent }}>Cut</H1>
        </H1>
        <P dim style={{ fontSize: 18, lineHeight: 26, marginTop: 8 }}>
          {L(
            "Самые яркие моменты стримов с Twitch, YouTube, Kick, VK и TikTok. Сами находятся, сами режутся и сразу приходят в Telegram.",
            "The best moments from Twitch, YouTube, Kick, VK and TikTok streams. Found, cut and sent to Telegram automatically.",
          )}
        </P>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 28 }}>
          {[[L("ЧАТ x6", "CHAT x6"), "#1f6b4f", 0], [L("ЗВУК", "AUDIO"), "#4b2c6b", 22], [L("ХАЙП", "HYPE"), "#6b4a1f", 0]].map(([t, col, top]) => (
            <View key={t as string} style={{ flex: 1, aspectRatio: 9 / 12, marginTop: top as number, borderRadius: 18,
                                             backgroundColor: col as string, padding: 9, opacity: 0.9 }}>
              <Tag>{t}</Tag>
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        {apple && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={999}
            style={{ height: 54 }}
            onPress={signInApple}
          />
        )}
        {DEMO ? (
          <Button title={L("Открыть демо", "Open demo")} busy={busy === "demo"}
                  onPress={() => run("demo", () => api.loginDev("demo"))} />
        ) : (
          <Button title={L("Продолжить с Google", "Continue with Google")} onPress={google} busy={busy === "google"}
                  kind={apple ? "outline" : "primary"} />
        )}
        {DEV_LOGIN && (
          <Button title={L("Тестовый вход", "Test sign-in")} kind="text" busy={busy === "dev"}
                  onPress={() => run("dev", () => api.loginDev("tester"))} />
        )}
        <P dim style={{ fontSize: 12, textAlign: "center", marginTop: 4 }}>
          {L("3 дня бесплатно · без карты. Продолжая, вы принимаете ", "3 days free · no card. By continuing you accept the ")}
          <P dim style={{ fontSize: 12, textDecorationLine: "underline" }} onPress={() => Linking.openURL(`${API_URL}/terms`)}>
            {L("условия использования", "terms of use")}
          </P>
          {" · "}
          <P dim style={{ fontSize: 12, textDecorationLine: "underline" }} onPress={() => Linking.openURL(`${API_URL}/privacy`)}>
            {L("конфиденциальность", "privacy")}
          </P>
        </P>
      </View>
    </Screen>
  );
}
