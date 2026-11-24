// Тарифы HypeCut. Всё на этой странице рисуется из данных сервера (/pricing): цены, часы, клипы, возможности,
// пакеты часов и разовая обработка мероприятий. Поменять тариф = поменять конфиг на сервере, интерфейс не трогаем.
import React, { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { api, DEMO, Me, Plan, Pricing } from "../api";
import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from "../config";
import { Button, c, H1, Icon, P, s, Tag } from "../ui";
import { L } from "../i18n";

// В магазинах приложений оплата идёт через App Store / Google Play (RevenueCat сообщает серверу о покупке).
// На сайте и в боте — картой или Telegram Stars: сервер отдаёт ссылку на оплату.
let configured = false;
function setupPurchases(userId: number): boolean {
  if (Platform.OS === "web") return false;
  const key = Platform.OS === "ios" ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  if (!key) return false;
  if (!configured) {
    Purchases.configure({ apiKey: key, appUserID: String(userId) });
    configured = true;
  }
  return true;
}

const usd = (v: number) => `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
const kzt = (v: number, rate: number) => `≈ ${(Math.round((v * rate) / 100) * 100).toLocaleString("ru-RU")} ₸`;
const num = (n: number) => n.toLocaleString("ru-RU");
const hoursText = (h: number) => L(`${num(h)} ч обработки`, `${num(h)} h processing`, `${num(h)} сағ өңдеу`);

/** Сколько часов осталось в этом месяце: тариф + докупленные. Нужна и в профиле, и на «Создать клипы». */
export function hoursLeft(me: Me): { left: number; total: number; used: number; low: boolean } | null {
  const h = me.plan?.hours;
  if (h == null) return null;
  const used = me.usage?.hours_used ?? 0;
  const total = h + (me.usage?.hours_extra ?? 0);
  const left = Math.max(0, Math.round((total - used) * 10) / 10);
  return { left, total, used, low: left <= total * 0.2 };
}

function Toggle({ value, onChange }: { value: "month" | "year"; onChange: (v: "month" | "year") => void }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: c.raised, borderRadius: 12, padding: 4 }}>
      {(["month", "year"] as const).map((v) => (
        <Pressable key={v} onPress={() => onChange(v)} testID={`period-${v}`}
                   style={{ flex: 1, height: 38, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: value === v ? c.card : "transparent" }}>
          <P style={{ fontWeight: "700", fontSize: 14, color: value === v ? c.fg : c.dim }}>{v === "month" ? L("Помесячно", "Monthly", "Ай сайын") : L("За год", "Yearly", "Жылына")}</P>
        </Pressable>
      ))}
    </View>
  );
}

function PlanCard({ p, pr, period, founder, current, busy, onChoose }: {
  p: Plan; pr: Pricing; period: "month" | "year"; founder: boolean; current: boolean; busy: boolean; onChoose: () => void;
}) {
  const k = period === "year" ? 12 * (1 - (pr.yearly_discount ?? 0)) : 1;
  const special = founder && p.founder_usd != null;
  const price = p.price_usd == null ? null : (special ? p.founder_usd! : p.price_usd) * k;
  const per = period === "year" ? L("год", "year", "жыл") : L("мес", "mo", "ай");
  return (
    <View style={[s.card, { gap: 12, borderWidth: p.best ? 2 : 1, borderColor: p.best ? c.accent : c.raised }]}>
      <View style={s.row}>
        <P style={{ fontSize: 20, fontWeight: "800" }}>{p.title}</P>
        {current ? <Tag>{L("ТВОЙ ТАРИФ", "YOUR PLAN", "СЕНІҢ ТАРИФІҢ")}</Tag> : p.best ? <Tag>{L("ПОПУЛЯРНЫЙ", "POPULAR", "ТАНЫМАЛ")}</Tag> : null}
      </View>
      {price == null ? (
        <P style={{ fontSize: 24, fontWeight: "800" }}>{L("Индивидуальная цена", "Custom pricing", "Жеке баға")}</P>
      ) : (
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <P style={{ fontSize: 32, fontWeight: "800", lineHeight: 38, color: special ? "#FFB020" : c.fg }}>{price === 0 ? "$0" : usd(price)}</P>
            {price > 0 && <P dim style={{ marginBottom: 5 }}>/ {per}</P>}
            {special && <P dim style={{ marginBottom: 5, textDecorationLine: "line-through" }}>{usd(p.price_usd! * k)}</P>}
          </View>
          {price > 0 && <P dim style={{ fontSize: 13 }}>{kzt(price, pr.kzt_per_usd)} / {per}</P>}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: c.raised, borderRadius: 12, padding: 10 }}>
          <P style={{ fontSize: 20, fontWeight: "800", color: c.accent }}>{p.hours == null ? "∞" : `${num(p.hours)} ${L("ч", "h", "сағ")}`}</P>
          <P dim style={{ fontSize: 12 }}>{L("обработки видео в месяц", "of video processing / mo", "айына видео өңдеу")}</P>
        </View>
        <View style={{ flex: 1, backgroundColor: c.raised, borderRadius: 12, padding: 10 }}>
          <P style={{ fontSize: 20, fontWeight: "800" }}>{p.ai_clips == null ? "∞" : L(`до ${num(p.ai_clips)}`, `up to ${num(p.ai_clips)}`)}</P>
          <P dim style={{ fontSize: 12 }}>{L("AI-клипов", "AI clips", "AI-клип")}</P>
        </View>
      </View>
      <View style={{ gap: 7 }}>
        {(p.features ?? []).map((f) => (
          <View key={f} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
            <Icon name="checkmark" size={16} color={c.accent} />
            <P style={{ fontSize: 14, flex: 1 }}>{f}</P>
          </View>
        ))}
      </View>
      {!current && p.price_usd !== 0 && (
        <Button title={p.contact ? L("Связаться с нами", "Contact us", "Бізбен байланысу") : `${L("Выбрать", "Choose", "Таңдау")} ${p.title}`}
                kind={p.best ? "primary" : "outline"} busy={busy} onPress={onChoose} />
      )}
    </View>
  );
}

export default function Plans({ me, onChange, onBack }: { me: Me; onChange: () => void; onBack?: () => void }) {
  const [pr, setPr] = useState<Pricing | null>(null);
  const [packages, setPackages] = useState<Record<string, PurchasesPackage>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [done, setDone] = useState<string | null>(null);
  const [quote, setQuote] = useState<string | null>(null);
  const [quoteText, setQuoteText] = useState("");

  useEffect(() => {
    api.pricing().then(setPr).catch(() => null);
    if (setupPurchases(me.id)) {
      Purchases.getOfferings()
        .then((o) => {
          const map: Record<string, PurchasesPackage> = {};
          for (const p of o.current?.availablePackages ?? []) map[p.product.identifier.toLowerCase()] = p;
          setPackages(map);
        })
        .catch(() => null);
    }
  }, []);

  const say = (t: string) => { setDone(t); setTimeout(() => setDone(null), 3500); };

  // магазин приложений: пакет с id вроде creator_month / hours_10; иначе — оплата на сервере (карта, Stars)
  async function pay(id: string, server: () => Promise<{ ok: boolean; url: string | null }>, okText: string) {
    setBusy(id);
    try {
      const pkg = packages[id] ?? Object.entries(packages).find(([k]) => k.includes(id))?.[1];
      if (pkg) {
        await Purchases.purchasePackage(pkg);
        setTimeout(onChange, 3000);
      } else {
        const r = await server();
        if (r.url) Linking.openURL(r.url);
        onChange();
      }
      say(okText);
    } catch (e: any) {
      if (!e?.userCancelled) DEMO ? say(String(e?.message ?? e)) : Alert.alert(L("Оплата не прошла", "Payment failed"), String(e?.message ?? e));
    }
    setBusy(null);
  }

  async function sendQuote() {
    setBusy("quote");
    await api.requestQuote(quote!, quoteText).catch(() => null);
    setBusy(null); setQuote(null); setQuoteText("");
    say(L("Заявка отправлена. Мы напишем тебе в Telegram.", "Request sent. We will message you on Telegram."));
  }

  const hl = hoursLeft(me);
  const founder = !!pr?.founder?.active;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32, gap: 14 }}>
      <View style={s.row}>
        <H1>{L("Тарифы", "Plans", "Тарифтер")}</H1>
        {onBack && <Button title={L("Назад", "Back")} kind="text" onPress={onBack} />}
      </View>
      {pr?.preliminary && (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: -6 }}>
          <Icon name="information-circle-outline" size={16} color={c.dim} />
          <P dim style={{ fontSize: 12, flex: 1 }}>
            {L("Стартовые цены. Лимиты могут измениться после запуска.", "Launch prices. Limits may change after launch.", "Бастапқы бағалар. Лимиттер өзгеруі мүмкін.")}
          </P>
        </View>
      )}

      {hl && (
        <View style={[s.card, { gap: 8, borderWidth: 1, borderColor: hl.low ? "#FFB020" : c.raised }]}>
          <View style={s.row}>
            <P style={{ fontWeight: "700" }}>{L("Осталось в этом месяце", "Left this month", "Осы айда қалды")}</P>
            <P style={{ fontWeight: "800", color: hl.low ? "#FFB020" : c.accent }}>{String(hl.left).replace(".", ",")} {L("ч", "h")} / {num(hl.total)} {L("ч", "h")}</P>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
            <View style={{ height: 6, width: `${Math.min(100, (hl.used / hl.total) * 100)}%`, backgroundColor: hl.low ? "#FFB020" : c.accent }} />
          </View>
        </View>
      )}

      {done && (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: c.accentDim, borderRadius: 12, padding: 12 }}>
          <Icon name="checkmark-circle" size={18} color={c.accent} />
          <P style={{ flex: 1, fontSize: 14 }}>{done}</P>
        </View>
      )}

      <Toggle value={period} onChange={setPeriod} />
      {period === "year" && pr?.yearly_discount == null && (
        <P dim style={{ fontSize: 12, marginTop: -6 }}>{L("Скидка за год появится позже. Пока цена = 12 месяцев.", "A yearly discount is coming. For now it is 12 months.")}</P>
      )}

      {founder && (
        <View style={{ borderRadius: 16, padding: 14, gap: 6, backgroundColor: "rgba(255,176,32,0.12)", borderWidth: 1.5, borderColor: "#FFB020" }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Icon name="flash" size={18} color="#FFB020" />
            <P style={{ fontWeight: "800", fontSize: 16, color: "#FFB020" }}>Founder Pricing</P>
            <View style={{ backgroundColor: "#FFB020", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
              <P style={{ fontSize: 11, fontWeight: "800", color: "#1A1200" }}>{L("ОГРАНИЧЕНО", "LIMITED", "ШЕКТЕУЛІ")}</P>
            </View>
          </View>
          <P style={{ fontSize: 13 }}>{pr!.founder!.note}</P>
        </View>
      )}

      {pr?.plans.map((p) => (
        <PlanCard key={p.id} p={p} pr={pr} period={period} founder={founder} current={me.plan?.id === p.id} busy={busy === p.id}
                  onChoose={() => p.contact ? setQuote("business")
                    : pay(p.id, () => api.choosePlan(p.id, period), L(`Тариф ${p.title} включён`, `${p.title} is active`))} />
      ))}

      {pr && pr.addons.length > 0 && (
        <View style={{ gap: 10, marginTop: 6 }}>
          <P style={{ fontWeight: "800", fontSize: 18 }}>{L("Дополнительные часы", "Extra hours", "Қосымша сағат")}</P>
          <P dim style={{ fontSize: 13, marginTop: -6 }}>{L("Если часы тарифа закончились. Докупленные часы не сгорают в конце месяца.", "When your plan's hours run out. Extra hours don't expire at month end.")}</P>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {pr.addons.map((a) => (
              <Pressable key={a.id} onPress={() => pay(a.id, () => api.buyHours(a.id), L(`Добавлено ${a.hours} ч обработки`, `${a.hours} h added`))} testID={`addon-${a.id}`}
                         style={{ flex: 1, backgroundColor: c.card, borderRadius: 14, padding: 12, gap: 4, alignItems: "center", opacity: busy === a.id ? 0.5 : 1 }}>
                <P style={{ fontSize: 20, fontWeight: "800", color: c.accent }}>+{a.hours} {L("ч", "h")}</P>
                <P style={{ fontWeight: "700" }}>{usd(a.price_usd)}</P>
                <P dim style={{ fontSize: 11 }}>{kzt(a.price_usd, pr.kzt_per_usd)}</P>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {pr && pr.events.length > 0 && (
        <View style={[s.card, { gap: 10, marginTop: 6 }]}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Icon name="mic-outline" size={20} color={c.accent} />
            <P style={{ fontWeight: "800", fontSize: 18 }}>Event Processing</P>
          </View>
          <P dim style={{ fontSize: 13 }}>
            {L("Разовая обработка мероприятия: конференция, форум, концерт. Без подписки, клипы готовы после события.",
               "One-off processing for an event: conference, forum, concert. No subscription.")}
          </P>
          {pr.events.map((e) => (
            <View key={e.id} style={[s.row, { paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.raised }]}>
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: "700" }}>{e.title}</P>
                <P dim style={{ fontSize: 12 }}>{e.note}</P>
              </View>
              <P style={{ fontWeight: "800" }}>{e.from_usd == null ? L("индивидуально", "custom") : `${L("от", "from")} ${usd(e.from_usd)}`}</P>
            </View>
          ))}
          <Button kind="outline" icon="chatbubble-ellipses-outline" title={L("Оставить заявку", "Request a quote", "Өтінім қалдыру")} onPress={() => setQuote("event")} />
        </View>
      )}

      {quote && (
        <View style={[s.card, { gap: 10, borderWidth: 1, borderColor: c.accent }]}>
          <P style={{ fontWeight: "800" }}>{quote === "event" ? L("Заявка на мероприятие", "Event request") : L("Заявка на Business", "Business request")}</P>
          <TextInput style={[s.input, { height: 90, paddingTop: 12, textAlignVertical: "top" }]} multiline value={quoteText} onChangeText={setQuoteText}
                     placeholder={quote === "event" ? L("Название, дата, сколько часов записи", "Name, date, hours of footage") : L("Компания и сколько часов видео в месяц", "Company and hours of video per month")}
                     placeholderTextColor={c.dim} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button style={{ flex: 1 }} kind="outline" title={L("Отмена", "Cancel")} onPress={() => setQuote(null)} />
            <Button style={{ flex: 1 }} title={L("Отправить", "Send")} busy={busy === "quote"} disabled={quoteText.trim().length < 3} onPress={sendQuote} />
          </View>
        </View>
      )}

      {setupPurchases(me.id) && (
        <Button title={L("Восстановить покупки", "Restore purchases")} kind="text"
                onPress={async () => { await Purchases.restorePurchases().catch(() => null); setTimeout(onChange, 3000); }} />
      )}
      <P dim style={{ fontSize: 12, textAlign: "center" }}>
        {L("Цена в тенге примерная, по текущему курсу. Подписка продлевается автоматически, отменить можно в любой момент.",
           "Tenge price is approximate. Subscriptions renew automatically and can be cancelled any time.")}
      </P>
    </ScrollView>
  );
}
