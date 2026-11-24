// «Создать клипы»: откуда взять длинное видео. Прямой эфир, файл с телефона, встреча или ссылка.
// Дальше всё одинаково: HypeCut AI сам слушает речь, находит лучшие моменты и кладёт их в очередь на «Эфире».
import * as DocumentPicker from "expo-document-picker";
import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { api, Integration, Me, Recording, Scenario, Source, SourceKind } from "../api";
import { L } from "../i18n";
import { Button, c, H1, Icon, P, platformColor, s } from "../ui";
import { hoursLeft } from "./Plans";

type IconName = React.ComponentProps<typeof Icon>["name"];

const KINDS = (): { id: SourceKind; title: string; sub: string; icon: IconName; color: string }[] => [
  { id: "live", title: L("Прямой эфир", "Live Stream", "Тікелей эфир"), sub: "Twitch, Kick, YouTube Live", icon: "radio-outline", color: "#FF4E45" },
  { id: "upload", title: L("Загрузить видео", "Upload Video", "Видео жүктеу"), sub: L("MP4, MOV с телефона", "MP4, MOV from phone", "Телефоннан MP4, MOV"), icon: "cloud-upload-outline", color: "#2EE59D" },
  { id: "meeting", title: L("Встреча / вебинар", "Meeting / Webinar", "Кездесу / вебинар"), sub: "Zoom, Google Meet, Teams", icon: "people-outline", color: "#4DA3FF" },
  { id: "url", title: L("Ссылка на видео", "Video URL", "Видео сілтемесі"), sub: L("YouTube, Vimeo, своя ссылка", "YouTube, Vimeo, your link", "YouTube, Vimeo, өз сілтемең"), icon: "link-outline", color: "#9D6BFF" },
];

/** Сценарий анализа: что AI считает интересным в этом видео. */
export const SCENARIOS = (): { id: Scenario; title: string; hint: string }[] => [
  { id: "auto", title: L("Авто", "Auto", "Авто"), hint: L("AI сам поймёт, что это за видео", "AI figures out what kind of video it is", "AI өзі түсінеді") },
  { id: "stream", title: L("Стрим / игра", "Stream / game", "Стрим / ойын"), hint: L("эмоции, реакции, крики, смешные и игровые моменты", "emotions, reactions, screams, funny and game moments") },
  { id: "podcast", title: L("Подкаст", "Podcast", "Подкаст"), hint: L("сильные цитаты, шутки, споры, смену собеседника", "strong quotes, jokes, debates, speaker changes") },
  { id: "interview", title: L("Интервью", "Interview", "Сұхбат"), hint: L("яркие ответы гостя и неожиданные признания", "the guest's best answers and surprising confessions") },
  { id: "lecture", title: L("Лекция / урок", "Lecture", "Дәріс"), hint: L("ключевые мысли, понятные примеры, вопросы из зала", "key ideas, clear examples, audience questions") },
  { id: "webinar", title: L("Вебинар", "Webinar", "Вебинар"), hint: L("главные советы и ответы на вопросы", "main tips and answers to questions") },
  { id: "meeting", title: L("Встреча", "Meeting", "Кездесу"), hint: L("решения, важные вопросы, итоги", "decisions, key questions, summaries") },
  { id: "event", title: L("Конференция", "Conference", "Конференция"), hint: L("цитаты спикеров, аплодисменты, анонсы", "speaker quotes, applause, announcements") },
];

/** Что делает AI-движок с любым видео, по шагам. Те же шаги видно в карточке обработки. */
export const ENGINE_STEPS = (): { id: string; title: string; icon: IconName }[] => [
  { id: "ingest", title: L("Получаем видео", "Getting the video", "Видео алу"), icon: "download-outline" },
  { id: "transcribe", title: L("Распознаём речь", "Recognizing speech", "Сөйлеуді тану"), icon: "mic-outline" },
  { id: "speakers", title: L("Находим, кто говорит", "Finding who speaks", "Кім сөйлейтінін табу"), icon: "people-outline" },
  { id: "analyze", title: L("Ищем цитаты, эмоции и мысли", "Finding quotes, emotions, ideas", "Дәйексөз, эмоция іздеу"), icon: "sparkles-outline" },
  { id: "detect", title: L("Режем по границам и оцениваем", "Cutting and scoring", "Кесу және бағалау"), icon: "cut-outline" },
  { id: "generate", title: L("Заголовки, субтитры, вертикаль", "Titles, captions, vertical", "Тақырып, субтитр"), icon: "text-outline" },
];

const SERVICE_COLOR: Record<string, string> = { zoom: "#2D8CFF", meet: "#00AC47", teams: "#6264A7" };
const mins = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)} ${L("ч", "h")} ${Math.round((sec % 3600) / 60)} ${L("мин", "min")}` : `${Math.round(sec / 60)} ${L("мин", "min")}`);

function ScenarioPicker({ value, onChange, only }: { value: Scenario; onChange: (v: Scenario) => void; only?: Scenario[] }) {
  const list = SCENARIOS().filter((x) => !only || only.includes(x.id));
  const cur = SCENARIOS().find((x) => x.id === value)!;
  return (
    <View style={{ gap: 8 }}>
      <P style={{ fontWeight: "700", fontSize: 14 }}>{L("Что это за видео?", "What kind of video?", "Бұл қандай видео?")}</P>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {list.map((x) => {
          const on = x.id === value;
          return (
            <Pressable key={x.id} onPress={() => onChange(x.id)} testID={`sc-${x.id}`}
                       style={{ paddingHorizontal: 12, height: 34, borderRadius: 9, justifyContent: "center", backgroundColor: on ? c.accent : c.raised }}>
              <P style={{ fontSize: 13, fontWeight: "600", color: on ? c.onAccent : c.fg }}>{x.title}</P>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
        <Icon name="sparkles" size={14} color={c.accent} />
        <P dim style={{ fontSize: 12, flex: 1 }}>{L("AI будет искать: ", "AI will look for: ", "AI іздейді: ")}{cur.hint}</P>
      </View>
    </View>
  );
}

/** Короткая схема движка внизу формы: человек видит, что произойдёт с видео. */
function EngineStrip() {
  return (
    <View style={{ backgroundColor: c.raised, borderRadius: 12, padding: 12, gap: 8 }}>
      <P style={{ fontWeight: "700", fontSize: 13 }}>{L("Что сделает HypeCut AI", "What HypeCut AI will do", "HypeCut AI не істейді")}</P>
      {ENGINE_STEPS().map((x, i) => (
        <View key={x.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <P dim style={{ fontSize: 12, width: 14 }}>{i + 1}</P>
          <Icon name={x.icon} size={15} color={c.accent} />
          <P style={{ fontSize: 13 }}>{x.title}</P>
        </View>
      ))}
    </View>
  );
}

function Check({ on, onPress, children }: { on: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }} testID="rights">
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? c.accent : c.dim, backgroundColor: on ? c.accent : "transparent", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        {on && <Icon name="checkmark" size={15} color={c.onAccent} />}
      </View>
      <P style={{ fontSize: 13, flex: 1 }}>{children}</P>
    </Pressable>
  );
}

export default function CreateClips({ me, onClose, onLive, onStarted, onPlans }: {
  me: Me; onClose: () => void; onLive: () => void; onStarted: (x: Source) => void; onPlans?: () => void;
}) {
  const hl = hoursLeft(me);
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [scenario, setScenario] = useState<Scenario>("auto");
  const [file, setFile] = useState<{ uri: string; name: string; size?: number } | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [services, setServices] = useState<Integration[]>([]);
  const [service, setService] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recording[]>([]);
  const [rec, setRec] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (kind === "meeting" && !services.length) api.integrations().then(setServices).catch(() => null); }, [kind]);
  useEffect(() => {
    setErr(null);
    setScenario(kind === "meeting" ? "meeting" : "auto");
  }, [kind]);

  async function pick() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["video/*"], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    setFile({ uri: a.uri, name: a.name, size: a.size ?? undefined });
    if (!title) setTitle(a.name.replace(/\.[^.]+$/, ""));
  }

  async function openService(id: string) {
    setService(id); setRec(null); setRecs([]);
    const it = services.find((x) => x.id === id);
    if (!it?.connected) {
      setBusy(id);
      try {
        const r = await api.connect(id);
        if (r.url) Linking.openURL(r.url);
        setServices(await api.integrations());
      } catch (e: any) { setErr(e.message); }
      setBusy(null);
    }
    try { setRecs(await api.recordings(id)); } catch {}
  }

  async function start() {
    setErr(null); setBusy("start");
    try {
      let x: Source;
      if (kind === "upload") {
        const up = await api.upload("source", file!.uri);
        x = await api.createSource({ kind: "upload", upload: up.id, title: title.trim() || undefined, scenario });
      } else if (kind === "url") {
        x = await api.createSource({ kind: "url", url: url.trim(), scenario, rights });
      } else {
        x = await api.createSource({ kind: "meeting", platform: service!, recording: rec!, scenario });
      }
      onStarted(x);
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }

  const ready = kind === "upload" ? !!file : kind === "url" ? !!url.trim() && rights : kind === "meeting" ? !!rec : false;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={s.row}>
        <H1>{L("Создать клипы", "Create Clips", "Клип жасау")}</H1>
        <Pressable hitSlop={10} onPress={onClose} testID="create-close"><Icon name="close" size={26} /></Pressable>
      </View>
      <P dim style={{ fontSize: 14, marginTop: -10 }}>
        {L("Выбери, откуда взять видео. HypeCut AI сам найдёт лучшие моменты и сделает из них вертикальные клипы.",
           "Pick where the video comes from. HypeCut AI finds the best moments and turns them into vertical clips.",
           "Видео қайдан алынатынын таңда. HypeCut AI ең жақсы сәттерді өзі табады.")}
      </P>

      {hl && (
        <Pressable onPress={onPlans} style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: -4, padding: hl.low ? 10 : 0, borderRadius: 10,
                                              backgroundColor: hl.low ? "rgba(255,176,32,0.12)" : "transparent" }}>
          <Icon name={hl.low ? "warning-outline" : "time-outline"} size={16} color={hl.low ? "#FFB020" : c.dim} />
          <P style={{ flex: 1, fontSize: 13, color: hl.low ? c.fg : c.dim }}>
            {L(`Осталось ${String(hl.left).replace(".", ",")} ч обработки из ${hl.total}`, `${hl.left} of ${hl.total} processing hours left`, `${hl.left} сағ қалды`)}
            {hl.low ? L(". Скоро закончится", ". Running low") : ""}
          </P>
          {hl.low && <P style={{ color: "#FFB020", fontWeight: "800", fontSize: 13 }}>{L("Докупить", "Buy more")}</P>}
        </Pressable>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {KINDS().map((k) => {
          const on = kind === k.id;
          return (
            <Pressable key={k.id} testID={`kind-${k.id}`} onPress={() => setKind(on ? null : k.id)}
                       style={{ width: "48%", flexGrow: 1, minHeight: 118, backgroundColor: c.card, borderRadius: 16, padding: 14, gap: 8,
                                borderWidth: 2, borderColor: on ? c.accent : "transparent" }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: k.color + "26", alignItems: "center", justifyContent: "center" }}>
                <Icon name={k.icon} size={22} color={k.color} />
              </View>
              <P style={{ fontWeight: "800", fontSize: 15 }}>{k.title}</P>
              <P dim style={{ fontSize: 12, marginTop: -4 }}>{k.sub}</P>
            </Pressable>
          );
        })}
      </View>

      {kind === "live" && (
        <View style={[s.card, { gap: 12 }]}>
          <P style={{ fontWeight: "800", fontSize: 16 }}>{L("Прямой эфир", "Live Stream", "Тікелей эфир")}</P>
          <P dim style={{ fontSize: 13 }}>
            {L("Во время эфира HypeCut сам смотрит стрим: чат, громкость, !clip от зрителей, эмоции и речь. Готовые моменты сразу попадают в очередь.",
               "During a stream HypeCut watches chat, loudness, viewers' !clip, emotions and speech. Moments land in your queue right away.")}
          </P>
          {me.channels.map((ch) => (
            <View key={ch.key} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ch.live ? c.danger : c.dim }} />
              <P style={{ flex: 1, fontWeight: "600" }}>{ch.display ?? ch.name}</P>
              <P dim style={{ fontSize: 12, color: platformColor(ch.platform) }}>{ch.platform_title}</P>
              <P dim style={{ fontSize: 12 }}>{ch.live ? L("в эфире", "live") : L("ждём эфир", "offline")}</P>
            </View>
          ))}
          <Button icon="add" title={L("Добавить канал", "Add a channel", "Арна қосу")} onPress={onLive} />
        </View>
      )}

      {kind === "upload" && (
        <View style={[s.card, { gap: 14 }]}>
          <P style={{ fontWeight: "800", fontSize: 16 }}>{L("Загрузить видео", "Upload Video", "Видео жүктеу")}</P>
          <Pressable onPress={pick} testID="pick-video"
                     style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: file ? c.accent : c.dim, borderRadius: 14, padding: 18, alignItems: "center", gap: 6 }}>
            <Icon name={file ? "videocam" : "cloud-upload-outline"} size={30} color={file ? c.accent : c.dim} />
            <P style={{ fontWeight: "700", textAlign: "center" }} numberOfLines={1}>{file ? file.name : L("Выбрать видео", "Choose a video", "Видео таңдау")}</P>
            <P dim style={{ fontSize: 12, textAlign: "center" }}>
              {file?.size ? `${(file.size / 1048576).toFixed(0)} ${L("МБ", "MB")} · ${L("нажми, чтобы заменить", "tap to replace")}` :
                L("Подкаст, интервью, лекция, запись стрима или конференции", "Podcast, interview, lecture, stream or conference recording")}
            </P>
          </Pressable>
          <TextInput value={title} onChangeText={setTitle} placeholder={L("Название (необязательно)", "Title (optional)")} placeholderTextColor={c.dim} style={s.input} />
          <ScenarioPicker value={scenario} onChange={setScenario} />
        </View>
      )}

      {kind === "url" && (
        <View style={[s.card, { gap: 14 }]}>
          <P style={{ fontWeight: "800", fontSize: 16 }}>{L("Ссылка на видео", "Video URL", "Видео сілтемесі")}</P>
          <TextInput value={url} onChangeText={setUrl} placeholder="https://youtube.com/watch?v=…" placeholderTextColor={c.dim} testID="url-input"
                     autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} />
          <P dim style={{ fontSize: 12, marginTop: -6 }}>
            {L("Свой YouTube-канал, Vimeo, запись подкаста или конференции по прямой ссылке.", "Your YouTube channel, Vimeo, a podcast or conference recording.")}
          </P>
          <ScenarioPicker value={scenario} onChange={setScenario} />
          <Check on={rights} onPress={() => setRights(!rights)}>
            {L("Это моё видео, или у меня есть право его использовать", "This is my video, or I have the right to use it", "Бұл менің видеом немесе құқығым бар")}
          </Check>
        </View>
      )}

      {kind === "meeting" && (
        <View style={[s.card, { gap: 12 }]}>
          <P style={{ fontWeight: "800", fontSize: 16 }}>{L("Встреча / вебинар", "Meeting / Webinar", "Кездесу / вебинар")}</P>
          <P dim style={{ fontSize: 13 }}>{L("Подключи сервис, и HypeCut возьмёт запись прямо оттуда.", "Connect a service and HypeCut takes the recording from there.")}</P>
          {services.map((x) => (
            <Pressable key={x.id} onPress={() => openService(x.id)} testID={`svc-${x.id}`}
                       style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: c.raised,
                                borderWidth: 1.5, borderColor: service === x.id ? c.accent : "transparent" }}>
              <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: SERVICE_COLOR[x.id], alignItems: "center", justifyContent: "center" }}>
                <Icon name={x.id === "zoom" ? "videocam" : x.id === "meet" ? "people" : "chatbubbles"} size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: "700" }}>{x.title}</P>
                <P dim style={{ fontSize: 12 }}>{x.connected ? `${L("Подключено", "Connected")} · ${x.account}` : L("Не подключено", "Not connected")}</P>
              </View>
              {busy === x.id ? <P dim style={{ fontSize: 12 }}>…</P> :
                <P style={{ color: c.accent, fontWeight: "700", fontSize: 13 }}>{x.connected ? L("Записи", "Recordings") : L("Подключить", "Connect")}</P>}
            </Pressable>
          ))}
          {service && recs.length > 0 && (
            <View style={{ gap: 8 }}>
              <P style={{ fontWeight: "700", fontSize: 14 }}>{L("Выбери запись", "Pick a recording", "Жазбаны таңда")}</P>
              {recs.map((r) => {
                const on = rec === r.id;
                return (
                  <Pressable key={r.id} onPress={() => { setRec(r.id); if (r.participants > 20) setScenario("webinar"); else if (r.participants <= 2) setScenario("interview"); else setScenario("meeting"); }}
                             testID={`rec-${r.id}`}
                             style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 10, borderRadius: 10, backgroundColor: on ? c.accentDim : c.raised }}>
                    <Icon name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? c.accent : c.dim} />
                    <View style={{ flex: 1 }}>
                      <P style={{ fontWeight: "600", fontSize: 14 }} numberOfLines={1}>{r.title}</P>
                      <P dim style={{ fontSize: 12 }}>
                        {new Date(r.date * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} · {mins(r.duration)} · {r.participants} {L("участн.", "people")}
                      </P>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          {rec && <ScenarioPicker value={scenario} onChange={setScenario} only={["meeting", "webinar", "interview", "lecture", "event"]} />}
          <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
            <Icon name="shield-checkmark-outline" size={14} color={c.dim} />
            <P dim style={{ fontSize: 12, flex: 1 }}>
              {L("Нарезай только те встречи, где участники знают о записи. Клипы видишь только ты.",
                 "Only clip meetings where people know they are recorded. Only you see the clips.")}
            </P>
          </View>
          <Pressable onPress={() => { setKind("upload"); setScenario("meeting"); }}>
            <P style={{ color: c.accent, fontWeight: "600", fontSize: 13 }}>{L("Или загрузить запись встречи файлом", "Or upload a meeting recording as a file")}</P>
          </Pressable>
        </View>
      )}

      {kind && kind !== "live" && (
        <>
          {err && <P style={{ color: c.danger, fontSize: 13 }}>{err}</P>}
          <Button icon="sparkles" title={busy === "start" ? L("Отправляем…", "Sending…") : L("Найти лучшие моменты", "Find the best moments", "Үздік сәттерді табу")}
                  busy={busy === "start"} disabled={!ready} onPress={start} />
          <EngineStrip />
        </>
      )}
    </ScrollView>
  );
}
