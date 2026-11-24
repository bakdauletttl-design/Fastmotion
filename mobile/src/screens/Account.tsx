import React, { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { getSettings, saveSettings, Settings } from "../settings";
import { api, Me, setToken } from "../api";
import { Button, c, Chips, H1, Icon, P, s, Tag, THEMES, ThemeId } from "../ui";
import { L, locale } from "../i18n";
import { hoursLeft } from "./Plans";
import Trust from "./Trust";

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

const themeNames = (): [ThemeId, string][] => [
  ["emerald", L("Изумруд", "Emerald")], ["light", L("Светлая", "Light")], ["neon", L("Неон", "Neon")], ["sunset", L("Закат", "Sunset")],
];

// Тема и язык: меняются сразу, без перезапуска
function Look({ onLook }: { onLook: () => void }) {
  const cur = getSettings();
  async function set(patch: Partial<Settings>) {
    await saveSettings(patch);
    onLook();
  }
  return (
    <View style={[s.card, { gap: 14 }]}>
      <P style={{ fontWeight: "700" }}>{L("Оформление", "Appearance")}</P>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {themeNames().map(([id, name]) => {
          const t = THEMES[id];
          const on = cur.theme === id;
          return (
            <Pressable key={id} onPress={() => set({ theme: id })} style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <View style={{ width: "100%", aspectRatio: 0.8, borderRadius: 14, backgroundColor: t.bg, padding: 8, gap: 5,
                             borderWidth: 2, borderColor: on ? c.accent : c.line, justifyContent: "flex-end" }}>
                <View style={{ height: 8, width: "70%", borderRadius: 4, backgroundColor: t.fg, opacity: 0.85 }} />
                <View style={{ height: 6, width: "50%", borderRadius: 3, backgroundColor: t.dim }} />
                <View style={{ height: 14, borderRadius: 7, backgroundColor: t.accent, marginTop: 4 }} />
              </View>
              <P style={{ fontSize: 12, fontWeight: on ? "700" : "500", color: on ? c.fg : c.dim }}>{name}</P>
            </Pressable>
          );
        })}
      </View>
      <P style={{ fontWeight: "700" }}>{L("Язык", "Language")}</P>
      <Chips items={[{ id: "auto", title: L("Как в телефоне", "Phone language") }, { id: "kk", title: "Қазақша" },
                     { id: "ru", title: "Русский" }, { id: "en", title: "English" }]}
             value={cur.lang} onChange={(lang) => set({ lang: lang as Settings["lang"] })} />
    </View>
  );
}

// Пожелания: чего не хватает в приложении. Письмо приходит нам, мы читаем и добавляем
function Wish() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function send() {
    if (text.trim().length < 3) return;
    setBusy(true);
    try {
      await api.feedback(text.trim());
      setText("");
      setSent(true);
    } catch (e: any) {
      Alert.alert(L("Не отправилось", "Not sent", "Жіберілмеді"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[s.card, { gap: 12 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="bulb-outline" size={20} color={c.accent} />
        <P style={{ fontWeight: "700" }}>{L("Пожелания", "Suggestions", "Ұсыныстар")}</P>
      </View>
      <P dim style={{ fontSize: 13 }}>
        {L("Чего-то не хватает? Напиши нам. Мы читаем каждое сообщение и добавляем то, что просят чаще всего.",
           "Missing something? Tell us. We read every message and build what people ask for most.",
           "Бірдеңе жетпей ме? Бізге жаз. Әр хатты оқимыз және жиі сұралғанын қосамыз.")}
      </P>
      {sent ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Icon name="checkmark-circle" size={20} color={c.accent} />
          <P style={{ flex: 1 }}>{L("Спасибо! Получили, посмотрим.", "Thanks! Got it, we'll take a look.", "Рахмет! Алдық, қараймыз.")}</P>
          <Pressable onPress={() => setSent(false)}><P style={{ color: c.accent }}>{L("Ещё", "More", "Тағы")}</P></Pressable>
        </View>
      ) : (
        <>
          <TextInput style={[s.input, { height: 96, paddingTop: 12, textAlignVertical: "top" }]} multiline value={text} onChangeText={setText} maxLength={2000}
                     placeholder={L("Например: хочу шаблоны для Reels", "E.g. I want Reels templates", "Мысалы: Reels үлгілері керек")} placeholderTextColor={c.dim} />
          <Button icon="send" title={L("Отправить", "Send", "Жіберу")} busy={busy} disabled={text.trim().length < 3} onPress={send} />
        </>
      )}
    </View>
  );
}

export default function Account({ me, onLogout, onTelegram, onPlans, onLook }:
  { me: Me; onLogout: () => void; onTelegram: () => void; onPlans: () => void; onLook: () => void }) {
  const until = me.plan_until ? new Date(me.plan_until * 1000).toLocaleDateString(locale()) : "—";
  const days = me.plan_until ? Math.max(0, Math.ceil((me.plan_until - Date.now() / 1000) / 86400)) : 0;
  const u = me.usage;
  const live = me.channels.filter((x) => x.live);
  const hl = hoursLeft(me);
  const [trust, setTrust] = useState<"rules" | "streamers" | null>(null);

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
            {hl && (
              <View style={{ gap: 6 }}>
                <View style={s.row}>
                  <P dim style={{ fontSize: 13 }}>{L("Часы обработки видео", "Video processing hours", "Видео өңдеу сағаты")}</P>
                  <P style={{ fontSize: 13, fontWeight: "700", color: hl.low ? "#FFB020" : c.fg }}>
                    {L("осталось", "left", "қалды")} {String(hl.left).replace(".", ",")} {L("из", "of")} {hl.total} {L("ч", "h")}
                  </P>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: c.bg, overflow: "hidden" }}>
                  <View style={{ height: 8, width: `${Math.min(100, (hl.used / hl.total) * 100)}%`, backgroundColor: hl.low ? "#FFB020" : c.accent }} />
                </View>
                {u?.hours_extra ? <P dim style={{ fontSize: 12 }}>{L(`в том числе ${u.hours_extra} ч докупленных`, `including ${u.hours_extra} h extra`)}</P> : null}
                {hl.low && (
                  <Pressable onPress={onPlans} style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "rgba(255,176,32,0.12)", borderRadius: 10, padding: 10 }}>
                    <Icon name="warning-outline" size={18} color="#FFB020" />
                    <P style={{ flex: 1, fontSize: 13 }}>
                      {hl.left <= 0 ? L("Часы обработки закончились. Докупи часы или повысь тариф.", "You are out of processing hours. Buy more or upgrade.")
                        : L("Часы обработки почти закончились. Докупи часы, чтобы видео не встали в очередь.", "Processing hours are almost gone. Buy more so videos keep processing.")}
                    </P>
                    <P style={{ color: "#FFB020", fontWeight: "800", fontSize: 13 }}>{L("Купить", "Buy")}</P>
                  </Pressable>
                )}
              </View>
            )}
            {me.plan.ai_clips != null && <Meter label={L("AI-клипы в этом месяце", "AI clips this month")} used={u?.ai_clips_used ?? 0} limit={me.plan.ai_clips} />}
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
              {me.plan.height >= 1440 ? "2K" : `${me.plan.height}p`}{me.plan.watermark ? ` · ${L("с водяным знаком", "watermarked")}` : ""} · {L("до", "until")} {until}
            </P>
          </>
        )}
        <Button title={L("Тарифы, часы и повышение", "Plans, hours and upgrade", "Тарифтер мен сағаттар")} onPress={onPlans} />
      </View>
      <Look onLook={onLook} />
      <Wish />
      <View style={[s.card, { paddingVertical: 4 }]}>
        {([["rules", "document-text-outline", L("Правила", "Rules", "Ережелер")], ["streamers", "videocam-outline", L("Для стримеров", "For streamers", "Стримерлерге")]] as const).map(([id, icon, title], i) => (
          <Pressable key={id} onPress={() => setTrust(id)} style={[s.row, { paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.raised }]}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <Icon name={icon} size={20} color={c.accent} />
              <P style={{ fontWeight: "600" }}>{title}</P>
            </View>
            <Icon name="chevron-forward" size={18} color={c.dim} />
          </Pressable>
        ))}
      </View>
      <Modal visible={!!trust} animationType="slide" onRequestClose={() => setTrust(null)}>
        {trust && <Trust start={trust} onClose={() => setTrust(null)} />}
      </Modal>
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
