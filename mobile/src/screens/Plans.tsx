import React, { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { api, Me, Plan } from "../api";
import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from "../config";
import { Button, c, H1, P, s, Tag } from "../ui";
import { L } from "../i18n";

// Оплата идёт через App Store / Google Play. RevenueCat сообщает серверу о покупке,
// и сервер сам включает тариф.
let configured = false;
function setupPurchases(userId: number): boolean {
  const key = Platform.OS === "ios" ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  if (!key) return false;
  if (!configured) {
    Purchases.configure({ apiKey: key, appUserID: String(userId) });
    configured = true;
  }
  return true;
}

const FEATURES: Record<string, string[]> = {
  trial: [L("1 канал", "1 channel"), L("до 5 клипов за стрим", "up to 5 clips per stream"), "720p", L("клипы в Telegram", "clips in Telegram")],
  standard: [
    "720p",
    L("3 канала", "3 channels"),
    L("до 20 клипов за стрим", "up to 20 clips per stream"),
    L("вертикальные клипы с субтитрами для TikTok, Shorts, Reels", "vertical clips with captions for TikTok, Shorts, Reels"),
  ],
  pro: [
    "1080p",
    L("6 каналов", "6 channels"),
    L("до 100 клипов за стрим", "up to 100 clips per stream"),
    L("всё из Standard", "everything in Standard"),
    L("клипы режутся в первую очередь", "priority processing"),
  ],
  max: [
    L("до 2K (1440p), если стример даёт такое качество", "up to 2K (1440p) when the stream has it"),
    L("10 каналов", "10 channels"),
    L("до 200 клипов за стрим", "up to 200 clips per stream"),
    L("клипы длиннее: +15 секунд", "longer clips: +15 seconds"),
    L("всё из Pro", "everything in Pro"),
  ],
};

export default function Plans({ me, onChange }: { me: Me; onChange: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packages, setPackages] = useState<Record<string, PurchasesPackage>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.plans().then(setPlans).catch(() => null);
    if (setupPurchases(me.id)) {
      Purchases.getOfferings()
        .then((o) => {
          const map: Record<string, PurchasesPackage> = {};
          for (const p of o.current?.availablePackages ?? []) {
            const id = p.product.identifier.toLowerCase();
            if (id.includes("max")) map.max = p;
            else if (id.includes("pro")) map.pro = p;
            else if (id.includes("standard")) map.standard = p;
          }
          setPackages(map);
        })
        .catch(() => null);
    }
  }, []);

  async function buy(planId: string) {
    const pkg = packages[planId];
    if (!pkg) {
      Alert.alert(L("Оплата скоро появится", "Payments coming soon"), L("Покупки ещё не подключены в магазине приложений.", "Purchases are not set up in the store yet."));
      return;
    }
    setBusy(planId);
    try {
      await Purchases.purchasePackage(pkg);
      // сервер получает подтверждение от магазина через несколько секунд
      setTimeout(onChange, 3000);
      Alert.alert(L("Спасибо!", "Thank you!"), L("Тариф включится через несколько секунд.", "Your plan will be active in a few seconds."));
    } catch (e: any) {
      if (!e?.userCancelled) Alert.alert(L("Оплата не прошла", "Payment failed"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!setupPurchases(me.id)) return;
    await Purchases.restorePurchases().catch(() => null);
    setTimeout(onChange, 3000);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32, gap: 14 }}>
      <H1>{L("Тарифы", "Plans")}</H1>
      {plans.map((p) => {
        const current = me.plan?.id === p.id;
        const best = p.id === "pro";
        const price = packages[p.id]?.product.priceString ?? (p.price_usd ? `$${p.price_usd}` : L("Бесплатно", "Free"));
        return (
          <View key={p.id} style={[s.card, best && { borderColor: c.accent }]}>
            <View style={s.row}>
              <P style={{ fontSize: 20, fontWeight: "800" }}>{p.title}</P>
              {current ? <Tag>{L("ТВОЙ ТАРИФ", "YOUR PLAN")}</Tag> : best ? <Tag>{L("ЛУЧШИЙ", "BEST")}</Tag> : null}
            </View>
            <P style={{ fontSize: 28, fontWeight: "800", marginTop: 6 }}>
              {price}
              {p.price_usd ? <P dim> / {L("месяц", "month")}</P> : null}
            </P>
            <View style={{ marginTop: 10, gap: 6 }}>
              {(FEATURES[p.id] ?? []).map((f) => (
                <View key={f} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
                  <P dim>{f}</P>
                </View>
              ))}
            </View>
            {p.id !== "trial" && !current && (
              <Button style={{ marginTop: 16 }} title={`${L("Выбрать", "Choose")} ${p.title}`} busy={busy === p.id}
                      kind={best ? "primary" : "outline"} onPress={() => buy(p.id)} />
            )}
          </View>
        );
      })}
      <Button title={L("Восстановить покупки", "Restore purchases")} kind="text" onPress={restore} />
      <P dim style={{ fontSize: 12, textAlign: "center" }}>
        {L(
          "Подписка продлевается автоматически. Отменить можно в настройках App Store или Google Play.",
          "Subscriptions renew automatically. Cancel any time in App Store or Google Play settings.",
        )}
      </P>
    </ScrollView>
  );
}
