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

const q = (h: number) => (h >= 1440 ? L("2K (1440p), если стример даёт такое качество", "2K (1440p) when the stream has it") : `${h}p`);
const mins = (sec: number) =>
  sec < 60 ? `${sec} ${L("сек", "s")}` : `${String(sec / 60).replace(".", L(",", "."))} ${L("мин", "min")}`;

// Что даёт тариф: собирается из цифр сервера, чтобы приложение и бот не расходились
function features(p: Plan): string[] {
  const ch = p.channels === 1 ? L("1 канал", "1 channel")
    : p.channels < 5 ? L(`${p.channels} канала`, `${p.channels} channels`) : L(`${p.channels} каналов`, `${p.channels} channels`);
  const out = [q(p.height), ch, L(`до ${p.clips_per_stream} клипов за стрим`, `up to ${p.clips_per_stream} clips per stream`),
               L(`клип до ${mins(p.max_seconds)}`, `clips up to ${mins(p.max_seconds)}`)];
  if (p.vertical) out.push(L("вертикаль 9:16 с субтитрами, монтаж и хайлайты", "9:16 with captions, editor and highlights"));
  if (p.priority) out.push(L("клипы режутся в первую очередь", "priority processing"));
  if (p.id === "trial") out.push(L("3 дня бесплатно, клипы в Telegram", "3 days free, clips in Telegram"));
  return out;
}

export default function Plans({ me, onChange, onBack }: { me: Me; onChange: () => void; onBack?: () => void }) {
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
      <View style={s.row}>
        <H1>{L("Тарифы", "Plans")}</H1>
        {onBack && <Button title={L("Назад", "Back")} kind="text" onPress={onBack} />}
      </View>
      {plans.map((p) => {
        const current = me.plan?.id === p.id;
        const best = p.id === "pro";
        const price = packages[p.id]?.product.priceString ?? (p.price_usd ? `$${Math.round(p.price_usd)}` : L("Бесплатно", "Free"));
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
              {features(p).map((f) => (
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
