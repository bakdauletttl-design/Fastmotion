import React, { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { api, Me, Plan } from "../api";
import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from "../config";
import { Button, c, H1, P, s, Tag } from "../ui";

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
  trial: ["1 канал", "до 5 клипов за стрим", "клипы в Telegram"],
  standard: ["3 канала", "до 20 клипов за стрим", "1080p", "вертикальные клипы для TikTok, Shorts, Reels"],
  pro: ["10 каналов", "клипы без лимита", "всё из Standard", "клипы режутся в первую очередь"],
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
            if (id.includes("pro")) map.pro = p;
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
      Alert.alert("Оплата скоро появится", "Покупки ещё не подключены в магазине приложений.");
      return;
    }
    setBusy(planId);
    try {
      await Purchases.purchasePackage(pkg);
      // сервер получает подтверждение от магазина через несколько секунд
      setTimeout(onChange, 3000);
      Alert.alert("Спасибо!", "Тариф включится через несколько секунд.");
    } catch (e: any) {
      if (!e?.userCancelled) Alert.alert("Оплата не прошла", String(e?.message ?? e));
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
      <H1>Тарифы</H1>
      {plans.map((p) => {
        const current = me.plan?.id === p.id;
        const best = p.id === "pro";
        const price = packages[p.id]?.product.priceString ?? (p.price_usd ? `$${p.price_usd}` : "Бесплатно");
        return (
          <View key={p.id} style={[s.card, best && { borderColor: c.accent }]}>
            <View style={s.row}>
              <P style={{ fontSize: 20, fontWeight: "800" }}>{p.title}</P>
              {current ? <Tag>ТВОЙ ТАРИФ</Tag> : best ? <Tag>ЛУЧШИЙ</Tag> : null}
            </View>
            <P style={{ fontSize: 28, fontWeight: "800", marginTop: 6 }}>
              {price}
              {p.price_usd ? <P dim> / месяц</P> : null}
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
              <Button style={{ marginTop: 16 }} title={`Выбрать ${p.title}`} busy={busy === p.id}
                      kind={best ? "primary" : "outline"} onPress={() => buy(p.id)} />
            )}
          </View>
        );
      })}
      <Button title="Восстановить покупки" kind="text" onPress={restore} />
      <P dim style={{ fontSize: 12, textAlign: "center" }}>
        Подписка продлевается автоматически. Отменить можно в настройках App Store или Google Play.
      </P>
    </ScrollView>
  );
}
