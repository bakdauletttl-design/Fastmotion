// Быстрый монтаж клипа: обрезка на таймлайне, формат, субтитры, заголовок, отправка
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useRef, useState } from "react";
import { Alert, PanResponder, ScrollView, Share, Switch, TextInput, View } from "react-native";
import { api, Clip, Me, Rendered, Style, withToken, Word } from "../api";
import { reel } from "../highlights";
import { L } from "../i18n";
import { saveToGallery } from "../save";
import { Button, c, Chips, P, s } from "../ui";
import StylePanel from "./StylePanel";

const time = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const HANDLE = 22;

/** Таймлайн с двумя ручками: начало и конец клипа. Касание полосы ставит туда плеер. */
export function TrimBar(p: {
  duration: number; start: number; end: number; position: number; moment: number | null;
  onChange: (start: number, end: number, moved: "start" | "end") => void; onSeek: (t: number) => void;
}) {
  const [width, setWidth] = useState(1);
  // ручки создаются один раз, а ширина и границы меняются: берём свежие значения через ref
  const ref = useRef(p);
  ref.current = p;
  const widthRef = useRef(width);
  widthRef.current = width;
  const toX = (t: number) => (t / Math.max(ref.current.duration, 0.1)) * widthRef.current;
  const toT = (x: number) => Math.min(Math.max(x / widthRef.current, 0), 1) * ref.current.duration;

  function handle(which: "start" | "end") {
    let from = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        from = toX(which === "start" ? ref.current.start : ref.current.end);
      },
      onPanResponderMove: (_, g) => {
        const t = toT(from + g.dx);
        const { start, end, onChange } = ref.current;
        // клип не короче секунды
        if (which === "start") onChange(Math.min(t, end - 1), end, "start");
        else onChange(start, Math.max(t, start + 1), "end");
      },
    });
  }
  const left = useRef(handle("start")).current;
  const right = useRef(handle("end")).current;

  const x0 = toX(p.start), x1 = toX(p.end);
  return (
    <View style={{ paddingHorizontal: HANDLE / 2 }}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(e) => p.onSeek(toT(e.nativeEvent.locationX))}
        style={{ height: 56, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, overflow: "visible" }}
      >
        {/* затемнение того, что будет вырезано */}
        <View style={{ position: "absolute", left: 0, width: x0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12 }} />
        <View style={{ position: "absolute", left: x1, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12 }} />
        <View style={{ position: "absolute", left: x0, width: Math.max(x1 - x0, 2), top: 0, bottom: 0,
                       borderWidth: 2, borderColor: c.accent, borderRadius: 10, backgroundColor: c.accentDim }} />
        {p.moment != null && (
          <View style={{ position: "absolute", left: toX(p.moment) - 1, width: 2, top: 6, bottom: 6, backgroundColor: "#FFE500" }} />
        )}
        <View style={{ position: "absolute", left: toX(p.position) - 1, width: 2, top: -4, bottom: -4, backgroundColor: c.fg }} />
        {[["start", x0, left], ["end", x1, right]].map(([k, x, pr]: any) => (
          <View key={k} {...pr.panHandlers} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{ position: "absolute", left: x - HANDLE / 2, top: -6, bottom: -6, width: HANDLE, borderRadius: 8,
                         backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: c.onAccent }} />
          </View>
        ))}
      </View>
      <View style={[s.row, { marginTop: 6 }]}>
        <P dim style={{ fontSize: 12 }}>{time(p.start)}</P>
        <P style={{ fontSize: 12, fontWeight: "700" }}>{(p.end - p.start).toFixed(1)} {L("сек", "s")}</P>
        <P dim style={{ fontSize: 12 }}>{time(p.end)}</P>
      </View>
    </View>
  );
}

/** Готовый ролик: смотреть, скачать, в Telegram, поделиться. */
export function Result(p: { video: string; onTelegram: () => Promise<unknown>; onBack: () => void }) {
  const url = withToken(p.video);
  const player = useVideoPlayer(url, (pl) => { pl.loop = true; pl.play(); });
  const [busy, setBusy] = useState<string | null>(null);
  async function run(k: string, f: () => Promise<unknown>, done?: string) {
    setBusy(k);
    try {
      await f();
      if (done) Alert.alert(done);
    } catch (e: any) {
      Alert.alert(L("Не получилось", "Failed"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={{ flex: 1, borderRadius: 24, overflow: "hidden", backgroundColor: c.card }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button style={{ flex: 1 }} kind="outline" title={L("Скачать", "Save")} busy={busy === "save"}
                onPress={() => run("save", () => saveToGallery(url))} />
        <Button style={{ flex: 1 }} title="Telegram" busy={busy === "tg"}
                onPress={() => run("tg", p.onTelegram, L("Отправил тебе в Telegram", "Sent to your Telegram"))} />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button style={{ flex: 1 }} kind="outline" title={L("Поделиться", "Share")} onPress={() => Share.share({ url, message: url })} />
        <Button style={{ flex: 1 }} kind="outline" title={L("Изменить", "Edit again")} onPress={p.onBack} />
      </View>
    </View>
  );
}

// Субтитры кусками по 3 слова: каждый кусок можно исправить, время делится между словами поровну
type Chunk = { start: number; end: number; text: string };

function toChunks(words: Word[]): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 0; i < words.length; i += 3) {
    const g = words.slice(i, i + 3);
    out.push({ start: g[0][0], end: g[g.length - 1][1], text: g.map((w) => w[2]).join(" ") });
  }
  return out;
}

function toWords(chunks: Chunk[]): Word[] {
  const out: Word[] = [];
  for (const ch of chunks) {
    const parts = ch.text.split(/\s+/).filter(Boolean);
    const step = (ch.end - ch.start) / Math.max(parts.length, 1);
    parts.forEach((t, i) => out.push([+(ch.start + i * step).toFixed(2), +(ch.start + (i + 1) * step).toFixed(2), t]));
  }
  return out;
}

function CaptionEditor({ chunks, start, end, onChange, onSeek }:
  { chunks: Chunk[]; start: number; end: number; onChange: (c: Chunk[]) => void; onSeek: (t: number) => void }) {
  const visible = chunks.map((ch, i) => ({ ch, i })).filter(({ ch }) => ch.end > start && ch.start < end);
  if (!visible.length) {
    return <P dim style={{ fontSize: 13 }}>{L("В этом куске стример ничего не говорит.", "Nothing is said in this part.")}</P>;
  }
  return (
    <View style={{ gap: 8 }}>
      {visible.map(({ ch, i }) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <P dim style={{ fontSize: 12, width: 44 }} onPress={() => onSeek(ch.start)}>{(ch.start - start).toFixed(1)}s</P>
          <TextInput style={[s.input, { flex: 1, minWidth: 0, height: 44 }]} value={ch.text} maxLength={60}
                     onChangeText={(text) => onChange(chunks.map((x, j) => (j === i ? { ...x, text } : x)))} />
        </View>
      ))}
    </View>
  );
}

export default function Editor({ clip, me, onClose }: { clip: Clip; me: Me | null; onClose: () => void }) {
  const full = clip.source_duration ?? clip.duration;
  const canVertical = !!me?.plan?.vertical;
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(full, me?.plan?.max_seconds ?? 30));
  const [pos, setPos] = useState(0);
  const [vertical, setVertical] = useState(canVertical);
  const [subtitles, setSubtitles] = useState(true);
  const [title, setTitle] = useState(clip.title ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Rendered | null>(null);
  const [style, setStyle] = useState<Style>({ font: "classic", music_volume: 0.35, overlay_pos: "top" });
  const [chunks, setChunks] = useState<Chunk[]>(() => toChunks(clip.words ?? []));
  const [fixing, setFixing] = useState(false);
  const maxLen = me?.plan?.max_seconds ?? 30;

  const startRef = useRef(start), endRef = useRef(end);
  startRef.current = start;
  endRef.current = end;
  const player = useVideoPlayer(withToken(clip.video), (pl) => { pl.loop = false; pl.play(); });
  // показываем только выбранный кусок: дошли до конца, возвращаемся к началу
  useEffect(() => {
    const id = setInterval(() => {
      const t = player.currentTime;
      setPos(t);
      if (t >= endRef.current) {
        player.currentTime = startRef.current;
        player.play();
      }
    }, 100);
    return () => clearInterval(id);
  }, [player]);

  function change(a: number, b: number, moved: "start" | "end") {
    // не длиннее, чем позволяет тариф
    if (b - a > maxLen) {
      if (moved === "start") b = a + maxLen;
      else a = b - maxLen;
    }
    setStart(a);
    setEnd(b);
    player.currentTime = moved === "start" ? a : Math.max(a, b - 1.5);
  }

  async function render() {
    setBusy(true);
    try {
      setDone(await api.edit(clip.id, { start, end, vertical, subtitles, title, ...style,
                                        words: fixing ? toWords(chunks) : null }));
      player.pause();
    } catch (e: any) {
      Alert.alert(L("Не получилось смонтировать", "Render failed"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function addToReel() {
    reel.add({ clip: clip.id, start, end, title: title || clip.channel, thumb: clip.thumb });
    Alert.alert(L("Добавлено в хайлайты", "Added to highlights"),
                L("Собери несколько моментов и склей их в один ролик во вкладке «Монтаж».",
                  "Collect a few moments and join them into one video in the Editor tab."));
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 32 }}>
      <View style={[s.row, { marginBottom: 12 }]}>
        <P style={{ fontWeight: "800", fontSize: 20 }}>{L("Монтаж", "Edit")}</P>
        <Button title={L("Закрыть", "Close")} kind="text" onPress={onClose} />
      </View>
      {done ? (
        <Result video={done.video} onBack={() => setDone(null)} onTelegram={() => api.sendClip(clip.id, done.id)} />
      ) : (
        <ScrollView contentContainerStyle={{ gap: 14 }}>
          <View style={{ height: 230, borderRadius: 20, overflow: "hidden", backgroundColor: c.card }}>
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" />
          </View>
          <TrimBar duration={full} start={start} end={end} position={pos} moment={clip.moment}
                   onChange={change} onSeek={(t) => { player.currentTime = t; player.play(); }} />
          <P dim style={{ fontSize: 12 }}>
            {L(`Тяни зелёные ручки, чтобы обрезать (на твоём тарифе до ${maxLen} сек). Жёлтая черта: самый яркий момент.`,
               `Drag the green handles to trim (up to ${maxLen} s on your plan). The yellow line is the peak moment.`,
               `Қию үшін жасыл тұтқаларды тарт (тарифіңде ${maxLen} сек дейін). Сары сызық: ең жарқын сәт.`)}
          </P>
          <Chips
            items={[{ id: "v", title: L("9:16 вебка + игра", "9:16 cam + game") }, { id: "h", title: "16:9" }]}
            value={vertical ? "v" : "h"}
            onChange={(v) => {
              if (v === "v" && !canVertical) {
                Alert.alert(L("Вертикальные клипы есть на Standard и выше", "Vertical clips are on Standard and above"));
                return;
              }
              setVertical(v === "v");
            }}
          />
          {vertical && (
            <>
              <TextInput style={s.input} value={title} onChangeText={setTitle} maxLength={80}
                         placeholder={L("Заголовок сверху (можно пусто)", "Hook title (optional)")} placeholderTextColor={c.dim} />
              <View style={[s.card, { paddingVertical: 10, gap: 10 }]}>
                <View style={s.row}>
                  <P>{L("Субтитры по словам", "Word-by-word captions")}</P>
                  <Switch value={subtitles} onValueChange={setSubtitles} trackColor={{ true: c.accent, false: c.line }} />
                </View>
                {subtitles && chunks.length > 0 && (
                  fixing
                    ? <CaptionEditor chunks={chunks} start={start} end={end} onChange={setChunks}
                                     onSeek={(t) => { player.currentTime = t; player.play(); }} />
                    : <Button kind="outline" title={L("✏️ Исправить текст субтитров", "✏️ Fix caption text")} onPress={() => setFixing(true)} />
                )}
              </View>
            </>
          )}
          <StylePanel value={style} onChange={setStyle} vertical={vertical} />
          <Button title={L("Смонтировать", "Render")} busy={busy} onPress={render} />
          <Button kind="outline" title={L("+ В хайлайты", "+ Add to highlights")} onPress={addToReel} />
        </ScrollView>
      )}
    </View>
  );
}
