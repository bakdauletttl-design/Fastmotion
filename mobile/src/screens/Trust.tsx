// «Правила» и «Для стримеров»: честно о том, что делает HypeCut, и как стример может отказаться от нарезки.
// Те же тексты есть на сервере: /terms и /streamers (для ссылок из магазинов и соцсетей).
import React, { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { api } from "../api";
import { L } from "../i18n";
import { Button, c, Chips, H1, Icon, P, s } from "../ui";

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={[s.card, { gap: 8 }]}>
      <P style={{ fontWeight: "800", fontSize: 16 }}>{title}</P>
      {items.map((t) => (
        <View key={t} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.accent, marginTop: 9 }} />
          <P style={{ flex: 1, fontSize: 14, color: c.dim }}>{t}</P>
        </View>
      ))}
    </View>
  );
}

function Rules() {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ backgroundColor: c.accentDim, borderRadius: 14, padding: 14 }}>
        <P style={{ fontSize: 14 }}>
          {L("Коротко: HypeCut — инструмент для нарезки, как видеоредактор. Клипы видишь только ты. Выложить клип в «Сообщество» или в TikTok можно, если это твоё видео или автор разрешил.",
             "In short: HypeCut is a clipping tool, like a video editor. Only you see your clips. You may post a clip to the Community or TikTok if it is your video or the creator allowed it.")}
        </P>
      </View>
      <Section title={L("Твои видео", "Your videos")} items={[
        L("Твои видео и клипы остаются твоими. Мы используем их только чтобы сделать и показать тебе клипы.", "Your videos and clips stay yours. We use them only to make and show you clips."),
        L("Мы не продаём их и не обучаем на них нейросети.", "We never sell them or use them for AI training."),
      ]} />
      <Section title={L("Чужое видео: как выкладывать правильно", "Someone else's video: posting it right")} items={[
        L("Эфиры, подкасты и интервью принадлежат их авторам. Сделать клип для себя можно, а выкладывать — только с разрешения.", "Streams, podcasts and interviews belong to their creators. Clip for yourself freely; post only with permission."),
        L("Многие стримеры сами разрешают нарезки. Спроси или проверь описание канала.", "Many streamers allow clipping. Ask or check their channel description."),
        L("Указывай автора: имя и ссылку на канал. Не выдавай чужое за своё.", "Credit the creator with a link. Never pass it off as yours."),
        L("Добавляй своё: комментарий, монтаж, субтитры. Не зарабатывай на чужом без согласия.", "Add your own value: commentary, edits, captions. Don't monetize without consent."),
        L("«Все так делают» — не право. TikTok и YouTube удаляют такие видео по жалобе и дают страйк.", "\"Everyone does it\" is not a right. TikTok and YouTube remove such videos on complaint and issue strikes."),
      ]} />
      <Section title={L("Сообщество HypeCut", "HypeCut Community")} items={[
        L("Выкладывая ролик, ты отмечаешь, чьё это видео, и подтверждаешь право его показывать.", "When posting, you say whose video it is and confirm you may share it."),
        L("Автор оригинала подписывается на ролике.", "The original creator is credited on the video."),
        L("Ты разрешаешь HypeCut показывать ролик в ленте, пока ты его не удалишь. Ролик остаётся твоим.", "You let HypeCut show the video in the feed until you delete it. It stays yours."),
        L("Любой может пожаловаться кнопкой с флажком. Жалоба автора сразу скрывает ролик до проверки.", "Anyone can report with the flag button. A creator's complaint hides the video right away."),
        L("За повторные нарушения закрываем доступ к публикации или аккаунт.", "Repeat violators lose posting rights or their account."),
      ]} />
      <Section title={L("Жалобы правообладателей", "Copyright complaints")} items={[
        L("Напиши в @HypeCut_bot: кто ты, что твоё, какой клип нарушает права. Удалим после проверки.", "Message @HypeCut_bot: who you are, what is yours, which clip infringes. We remove it after review."),
        L("Стример может запретить нарезку своего канала совсем: вкладка «Для стримеров».", "Streamers can stop all clipping of their channel: For streamers tab."),
      ]} />
      <Section title={L("Встречи и вебинары", "Meetings and webinars")} items={[
        L("Импортируй только свои записи и те, к которым у тебя законный доступ.", "Import only recordings you have lawful access to."),
        L("Участники должны знать о записи. Согласие получаешь ты.", "Participants must know they are recorded. Getting consent is on you."),
        L("Записи нужны только для твоих клипов. Мы их не продаём и не обучаем на них нейросети.", "Recordings are used only for your clips: never sold or used for AI training."),
      ]} />
      <Section title={L("Что нельзя", "Not allowed")} items={[
        L("Травля, слежка, чужие личные разговоры без согласия, насилие, 18+, мошенничество.", "Harassment, surveillance, private talks without consent, violence, adult content, fraud."),
      ]} />
      <Section title={L("Тарифы", "Plans")} items={[
        L("Цены стартовые. Об изменениях предупредим заранее, оплаченный период не меняется.", "Launch prices. We announce changes in advance; paid periods never change."),
        L("Founder Pricing сохраняется, пока подписка активна без перерыва.", "Founder Pricing stays while your subscription is active without a break."),
        L("Часы тарифа обновляются каждый месяц, докупленные часы не сгорают.", "Plan hours reset monthly; extra hours never expire."),
        L("На Free на клипах небольшой водяной знак HypeCut.", "Free clips carry a small HypeCut watermark."),
      ]} />
    </View>
  );
}

function Streamers() {
  const [channel, setChannel] = useState("");
  const [contact, setContact] = useState("");
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function send() {
    setBusy(true); setMsg(null);
    try {
      await api.optOut(channel.trim(), contact.trim(), text.trim(), owner);
      setMsg({ ok: true, t: L("Заявка отправлена. Мы свяжемся, чтобы подтвердить, что канал ваш.", "Request sent. We will contact you to confirm the channel is yours.") });
      setChannel(""); setContact(""); setText(""); setOwner(false);
    } catch (e: any) { setMsg({ ok: false, t: e.message }); }
    setBusy(false);
  }

  return (
    <View style={{ gap: 12 }}>
      <Section title={L("Как мы работаем с вашим каналом", "How we treat your channel")} items={[
        L("Сам HypeCut ничего не публикует: клипы приходят лично тому, кто их сделал.", "HypeCut itself publishes nothing: clips go privately to whoever made them."),
        L("Выложить ваш клип в «Сообщество» можно только с отметкой, что вы разрешили. Ваш канал подписывается как автор.", "Your clip can be posted to the Community only marked as allowed by you, with your channel credited."),
        L("Нажмите флажок «Это мой контент» на любом ролике: он сразу скроется до проверки.", "Tap the flag \"This is my content\" on any video: it is hidden right away pending review."),
        L("Мы не продаём ваши клипы и не выдаём себя за ваших клиперов.", "We do not sell your clips or pose as your clippers."),
        L("Записи эфиров удаляются с сервера через несколько дней.", "Stream recordings are deleted after a few days."),
      ]} />
      <View style={[s.card, { gap: 10 }]}>
        <P style={{ fontWeight: "800", fontSize: 16 }}>{L("Не нарезать мой канал", "Stop clipping my channel")}</P>
        <P dim style={{ fontSize: 13 }}>
          {L("Проверим, что канал ваш, перестанем делать клипы для всех и удалим сохранённые клипы и ролики в «Сообществе».", "We verify ownership, stop clipping for everyone and delete stored clips and Community posts.")}
        </P>
        <TextInput value={channel} onChangeText={setChannel} placeholder="twitch.tv/ник или youtube.com/@канал" placeholderTextColor={c.dim}
                   autoCapitalize="none" style={s.input} testID="optout-channel" />
        <TextInput value={contact} onChangeText={setContact} placeholder={L("Telegram @ник или почта", "Telegram @name or email")} placeholderTextColor={c.dim}
                   autoCapitalize="none" style={s.input} />
        <TextInput value={text} onChangeText={setText} placeholder={L("Комментарий (необязательно)", "Comment (optional)")} placeholderTextColor={c.dim}
                   multiline style={[s.input, { height: 70, paddingTop: 12, textAlignVertical: "top" }]} />
        <Pressable onPress={() => setOwner(!owner)} style={{ flexDirection: "row", gap: 10, alignItems: "center" }} testID="optout-owner">
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: owner ? c.accent : c.dim, backgroundColor: owner ? c.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
            {owner && <Icon name="checkmark" size={15} color={c.onAccent} />}
          </View>
          <P style={{ fontSize: 13, flex: 1 }}>{L("Я владелец канала или его представитель", "I own this channel or represent the owner")}</P>
        </Pressable>
        {msg && <P style={{ fontSize: 13, color: msg.ok ? c.accent : c.danger }}>{msg.t}</P>}
        <Button title={L("Отправить заявку", "Send request")} busy={busy} disabled={!channel.trim() || contact.trim().length < 3 || !owner} onPress={send} />
      </View>
      <View style={[s.card, { gap: 6 }]}>
        <P style={{ fontWeight: "800", fontSize: 16 }}>{L("Хотите больше клипов?", "Want more clips?")}</P>
        <P dim style={{ fontSize: 13 }}>
          {L("Подключите свой канал в HypeCut: лучшие моменты будут приходить вам сразу после эфира, а что выкладывать — решаете вы.",
             "Connect your own channel: the best moments arrive right after the stream, and you decide what to post.")}
        </P>
      </View>
    </View>
  );
}

export default function Trust({ onClose, start = "rules" }: { onClose: () => void; start?: "rules" | "streamers" }) {
  const [tab, setTab] = useState<"rules" | "streamers">(start);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={s.row}>
        <H1>{tab === "rules" ? L("Правила", "Rules", "Ережелер") : L("Для стримеров", "For streamers", "Стримерлерге")}</H1>
        <Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={26} /></Pressable>
      </View>
      <Chips items={[{ id: "rules", title: L("Правила", "Rules", "Ережелер") }, { id: "streamers", title: L("Для стримеров", "For streamers", "Стримерлерге") }]}
             value={tab} onChange={setTab} />
      {tab === "rules" ? <Rules /> : <Streamers />}
    </ScrollView>
  );
}
