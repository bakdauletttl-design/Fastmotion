// Монтаж в стиле видеоредактора. Всё хранится как проект: куски клипов на ленте, свои надписи,
// наложения (фото, гифки, видео), несколько аудио, свои шрифты, формат, масштаб и качество.
// Сверху превью, под ним лента с курсором по центру, внизу инструменты.
import { useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as Font from "expo-font";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, PanResponder, Platform, Pressable, ScrollView, Share, Switch, Text, TextInput,
  useWindowDimensions, View,
} from "react-native";
import { api, Clip, Me, Style, withToken } from "../api";
import { L } from "../i18n";
import {
  Anim, Aspect, AudioTrack, CustomFont, fixProject, Key, Layer, LayoutId, newProject, Project, projects, presets, Rect, REGIONS, Seg, TextLayer, uid, usePresets,
} from "../project";
import { saveToGallery, shareToTikTok } from "../save";
import { Button, c, Chips, FONT, Icon, IconName, P, s, withFont } from "../ui";
import { ColorRow, DEFAULT_COLORS, fontChoices } from "./StylePanel";

const TOP = Platform.OS === "web" ? 10 : 50;
let PX = 56; // пикселей ленты на секунду: кнопки −/+ и щипок двумя пальцами
const ZOOM_MIN = 12, ZOOM_MAX = 220;
const STRIP_H = 50;
const HANDLE = 16;

const clock = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;
const clockMs = (t: number) => `${clock(t)}.${Math.floor((t % 1) * 10)}`;
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const sp = (sg: Seg) => sg.speed ?? 1;
const segLen = (sg: Seg) => (sg.end - sg.start) / sp(sg); // на ленте кусок с ускорением короче
const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const fullOf = (cl: Clip) => cl.source_duration ?? cl.duration;

// Форматы кадра. 9:16 — вебка сверху и игра снизу, остальные — кадр по центру
export const ASPECTS: { id: Aspect; r: number; hint: () => string }[] = [
  { id: "9:16", r: 9 / 16, hint: () => "TikTok, Reels, Shorts" },
  { id: "16:9", r: 16 / 9, hint: () => L("Как на стриме", "Like the stream", "Стримдегідей") },
  { id: "1:1", r: 1, hint: () => L("Квадрат", "Square", "Шаршы") },
  { id: "4:5", r: 4 / 5, hint: () => L("Лента Instagram", "Instagram feed") },
  { id: "3:4", r: 3 / 4, hint: () => L("Вертикально", "Portrait", "Тік") },
  { id: "4:3", r: 4 / 3, hint: () => L("Классика", "Classic", "Классика") },
  { id: "5:4", r: 5 / 4, hint: () => L("Почти квадрат", "Almost square", "Шаршыға жақын") },
];
const QUALITIES = [480, 720, 1080, 1440];

// Готовые стили субтитров для стримеров: выбрал — и всё оформлено
export const CAPTION_PRESETS = (): { id: string; name: string; style: Partial<Style> }[] => [
  { id: "classic", name: L("Классика", "Classic", "Классика"), style: { font: "classic", text_color: "#FFFFFF", word_color: "#2EE59D", stroke: true, shadow: true, upper: true, anim: "none" } },
  { id: "hype", name: L("Хайп", "Hype", "Хайп"), style: { font: "russo", text_color: "#FFFFFF", word_color: "#FFE500", stroke: true, shadow: true, upper: true, anim: "pop" } },
  { id: "fire", name: L("Огонь", "Fire", "От"), style: { font: "russo", text_color: "#FFFFFF", word_color: "#FF5A1F", stroke: true, shadow: true, upper: true, anim: "pop" } },
  { id: "neon", name: L("Неон", "Neon", "Неон"), style: { font: "classic", text_color: "#7DF9FF", word_color: "#FF3DF2", stroke: false, shadow: true, upper: true, anim: "fade" } },
  { id: "minimal", name: L("Минимал", "Minimal", "Минимал"), style: { font: "classic", text_color: "#FFFFFF", word_color: "#FFFFFF", stroke: false, shadow: true, upper: false, anim: "fade" } },
  { id: "podcast", name: L("Подкаст", "Podcast", "Подкаст"), style: { font: "classic", text_color: "#FFFFFF", word_color: "#B79CFF", stroke: false, shadow: true, upper: false, anim: "slide" } },
];
const ANIMS = (): { id: Anim; title: string }[] => [
  { id: "none", title: L("Без анимации", "None", "Анимациясыз") }, { id: "pop", title: L("Выпрыгивает", "Pop", "Секіру") },
  { id: "fade", title: L("Проявляется", "Fade", "Білінеді") }, { id: "slide", title: L("Снизу", "Slide up", "Төменнен") },
];

// Шаблоны раскладки 9:16: из одного кадра стрима вырезаются вебка, игра или чат и ставятся друг над другом
type Region = "cam" | "game" | "chat";
export const LAYOUTS = (): { id: LayoutId; name: string; hint: string; areas: { region: Region; h: number }[]; band?: number; style?: Partial<Style> }[] => [
  { id: "full", name: "Gameplay", hint: L("Игра на весь экран", "Game full screen", "Ойын толық экранда"), areas: [] },
  { id: "gaming", name: "Gaming", hint: L("Вебка сверху, игра снизу", "Cam on top, game below", "Камера жоғарыда, ойын төменде"),
    areas: [{ region: "cam", h: 0.36 }, { region: "game", h: 0.64 }], style: { caption_y: 0.42, title_y: 0.07 } },
  { id: "facecam", name: "Facecam", hint: L("Большое лицо, маленькая игра", "Big face, small game", "Үлкен бет, кіші ойын"),
    areas: [{ region: "cam", h: 0.6 }, { region: "game", h: 0.4 }], style: { caption_y: 0.66, title_y: 0.07 } },
  { id: "chat", name: "Chat Reaction", hint: L("Игра и чат стрима", "Game and stream chat", "Ойын мен чат"),
    areas: [{ region: "game", h: 0.62 }, { region: "chat", h: 0.38 }], style: { caption_y: 0.55, title_y: 0.07 } },
  { id: "podcast", name: "Podcast", hint: L("Говорящая голова и субтитры", "Talking head and captions", "Сөйлеп тұрған адам мен субтитр"),
    areas: [{ region: "cam", h: 1 }], style: { caption_y: 0.72, title_y: 0.1 } },
  { id: "meme", name: "Meme", hint: L("Белая плашка с текстом сверху", "White caption bar on top", "Жоғарыда ақ жолақ"),
    areas: [{ region: "game", h: 0.76 }], band: 0.24, style: { title_y: 0.12, title_color: "#000000", caption_y: 0.8 } },
  { id: "split", name: "Split Screen", hint: L("Два окна поровну", "Two equal windows", "Екі тең терезе"),
    areas: [{ region: "game", h: 0.5 }, { region: "cam", h: 0.5 }], style: { caption_y: 0.5, title_y: 0.07 } },
];
const regionName = (r: Region) => (r === "cam" ? L("Вебка", "Cam", "Камера") : r === "chat" ? L("Чат", "Chat", "Чат") : L("Игра", "Game", "Ойын"));

/** Масштаб и сдвиг видео в момент t: между ключевыми кадрами плавно. */
function tfAt(proj: Project, t: number) {
  const k = [...proj.keys].sort((a, b) => a.t - b.t);
  if (!k.length) return { zoom: proj.zoom, panX: proj.panX, panY: proj.panY };
  if (t <= k[0].t) return k[0];
  if (t >= k[k.length - 1].t) return k[k.length - 1];
  const i = k.findIndex((x, j) => t >= x.t && t < k[j + 1].t);
  const a = k[i], b = k[i + 1];
  const f0 = (t - a.t) / Math.max(b.t - a.t, 0.01), f = f0 * f0 * (3 - 2 * f0);
  return { zoom: a.zoom + (b.zoom - a.zoom) * f, panX: a.panX + (b.panX - a.panX) * f, panY: a.panY + (b.panY - a.panY) * f };
}

/** Обводка и тень текста. */
const textFx = (stroke?: boolean, shadow?: boolean): any =>
  stroke ? { textShadowColor: "#000", textShadowRadius: 1.5, textShadowOffset: { width: 1.5, height: 1.5 } }
         : shadow === false ? {} : { textShadowColor: "rgba(0,0,0,0.85)", textShadowRadius: 6 };
/** Анимация появления: since — сколько секунд текст уже на экране. */
function animFx(anim: Anim | undefined, since: number): any {
  const k = clamp(since / 0.35, 0, 1);
  if (anim === "pop") return { transform: [{ scale: 0.5 + 0.5 * k }] };
  if (anim === "fade") return { opacity: k };
  if (anim === "slide") return { opacity: k, transform: [{ translateY: (1 - k) * 18 }] };
  return null;
}
const qName = (q: number) => (q >= 1440 ? "2K" : `${q}p`);

// Субтитры кусками по 3 слова: каждый кусок можно исправить
type Chunk = { start: number; end: number; text: string };
function toChunks(words: [number, number, string][]): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 0; i < words.length; i += 3) {
    const g = words.slice(i, i + 3);
    out.push({ start: g[0][0], end: g[g.length - 1][1], text: g.map((w) => w[2]).join(" ") });
  }
  return out;
}
function toWords(chunks: Chunk[]): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (const ch of chunks) {
    const parts = ch.text.split(/\s+/).filter(Boolean);
    const step = (ch.end - ch.start) / Math.max(parts.length, 1);
    parts.forEach((t, i) => out.push([+(ch.start + i * step).toFixed(2), +(ch.start + (i + 1) * step).toFixed(2), t]));
  }
  return out;
}

/** Кадры клипа: из полоски-картинки или повтором обложки. */
function Frames({ clip, start, width, speed = 1 }: { clip: Clip; start: number; width: number; speed?: number }) {
  if (clip.strip) {
    return <Image source={{ uri: withToken(clip.strip) }} contentFit="fill"
                  style={{ position: "absolute", top: 0, height: STRIP_H, width: (fullOf(clip) * PX) / speed, left: (-start * PX) / speed }} />;
  }
  const tw = Math.round((STRIP_H * 16) / 9);
  return (
    <View style={{ flexDirection: "row" }}>
      {clip.thumb ? Array.from({ length: Math.ceil(width / tw) }, (_, i) => (
        <Image key={i} source={{ uri: withToken(clip.thumb!) }} style={{ width: tw, height: STRIP_H }} contentFit="cover" />
      )) : null}
    </View>
  );
}

/** Готовый ролик: смотреть, скачать, Telegram, TikTok, поделиться. */
export function Result(p: { video: string; onTelegram: () => Promise<unknown>; onBack: () => void }) {
  const url = withToken(p.video);
  const player = useVideoPlayer(url, (pl) => { pl.loop = true; });
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
  const actions: [string, IconName, string, () => void][] = [
    ["save", "download-outline", L("Скачать", "Save"), () => run("save", () => saveToGallery(url))],
    ["tg", "paper-plane-outline", "Telegram", () => run("tg", p.onTelegram, L("Отправил тебе в Telegram", "Sent to your Telegram"))],
    ["tiktok", "logo-tiktok", "TikTok", () => run("tiktok", () => shareToTikTok(url))],
    ["share", "share-outline", L("Поделиться", "Share"), () => Share.share({ url, message: url })],
    ["edit", "create-outline", L("Изменить", "Edit again"), p.onBack],
  ];
  return (
    <View style={{ flex: 1, gap: 16, paddingBottom: 12 }}>
      <View style={{ flex: 1, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls playsInline />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
        {actions.map(([k, icon, label, f]) => (
          <Pressable key={k} onPress={f} disabled={!!busy} style={{ alignItems: "center", gap: 6, width: 64, opacity: busy && busy !== k ? 0.5 : 1 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center",
                           backgroundColor: k === "tg" ? c.accent : c.raised }}>
              <Icon name={icon} size={22} color={k === "tg" ? c.onAccent : c.fg} />
            </View>
            <P style={{ fontSize: 12 }}>{busy === k ? "…" : label}</P>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// касание: в браузере координаты в списке касаний, на телефоне — в самом событии
const point = (e: any) => {
  const n = e.nativeEvent, t = n.touches?.[0] ?? n.changedTouches?.[0] ?? n;
  return { px: t.pageX ?? n.pageX, py: t.pageY ?? n.pageY };
};

/** То, что лежит поверх видео и двигается пальцем: надпись, субтитры, фото. x, y — центр в долях кадра. */
function Movable({ x, y, w, h, onMove, onTap, selected, children, faded, locked }:
  { x: number; y: number; w: number; h: number; onMove: (x: number, y: number) => void; onTap?: () => void;
    selected?: boolean; children: React.ReactNode; faded?: boolean; locked?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(false);
  const live = useRef({ x, y, w, h, onMove });
  live.current = { x, y, w, h, onMove };
  const from = useRef({ x: 0, y: 0, px: 0, py: 0, moved: false });
  const touch = {
    onStartShouldSetResponder: () => true,
    onTouchStart: (e: any) => {
      e.stopPropagation?.();
      from.current = { x: live.current.x, y: live.current.y, ...point(e), moved: false };
      setActive(true);
    },
    onTouchMove: (e: any) => {
      e.stopPropagation?.();
      if ((e.nativeEvent.touches?.length ?? 1) > 1) return;
      const { px, py } = point(e);
      if (Math.abs(px - from.current.px) + Math.abs(py - from.current.py) > 4) from.current.moved = true;
      const { w, h, onMove } = live.current;
      if (locked) return;
      onMove(clamp(from.current.x + (px - from.current.px) / w, 0.05, 0.95), clamp(from.current.y + (py - from.current.py) / h, 0.04, 0.96));
    },
    onTouchEnd: (e: any) => {
      e.stopPropagation?.();
      setActive(false);
      if (!from.current.moved) onTap?.();
    },
    onTouchCancel: () => setActive(false),
  };
  const ring = locked ? "transparent" : active || selected ? c.accent : "rgba(255,255,255,0.45)";
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: clamp(y * h - size.h / 2, 0, Math.max(h - size.h, 0)), alignItems: "flex-start" }}>
      <View {...touch} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            style={{ maxWidth: w - 8, marginLeft: clamp(x * w - size.w / 2, 2, Math.max(w - size.w - 2, 2)),
                     padding: 2, borderRadius: 6, opacity: faded && !active ? 0.55 : 1,
                     borderWidth: 1.5, borderStyle: "dashed", borderColor: ring }}>
        {children}
      </View>
    </View>
  );
}

/** Видео поверх клипа: в превью крутится без звука. */
function OverlayVideo({ uri, width, height }: { uri: string; width: number; height: number }) {
  const pl = useVideoPlayer(uri, (x) => { x.loop = true; x.muted = true; x.play(); });
  return <VideoView player={pl} style={{ width, height }} contentFit="cover" nativeControls={false} playsInline />;
}

/** Аудиодорожка в превью: играет вместе с видео со своей громкостью. */
function AudioPreview({ track, playing, pos, total }: { track: AudioTrack; playing: boolean; pos: number; total: number }) {
  const pl = useAudioPlayer(track.uri);
  const posRef = useRef(pos);
  posRef.current = pos;
  // плавное начало и конец — по секунде
  const fade = Math.min(track.fadeIn ? clamp(pos / 1, 0, 1) : 1, track.fadeOut ? clamp((total - pos) / 1, 0, 1) : 1);
  const vol = track.muted ? 0 : track.volume * fade;
  useEffect(() => { pl.volume = vol; }, [vol, pl]);
  useEffect(() => {
    try {
      if (playing) {
        pl.seekTo(posRef.current).catch(() => null);
        pl.play();
      } else pl.pause();
    } catch {}
  }, [playing, pl]);
  return null;
}

/** Кусок исходного кадра (вебка, игра или чат) в своём окне. Одним пальцем двигаешь, двумя меняешь размер. */
function Crop({ player, rect, w, h, region, onRect }:
  { player: any; rect: Rect; w: number; h: number; region: Region; onRect: (r: Rect) => void }) {
  const SA = 16 / 9; // исходник стрима
  const innerW = Math.max(w / rect.w, (h * SA) / rect.h), innerH = innerW / SA;
  const left = -rect.x * innerW - (rect.w * innerW - w) / 2, top = -rect.y * innerH - (rect.h * innerH - h) / 2;
  const [active, setActive] = useState(false);
  const live = useRef({ rect, innerW, innerH, onRect });
  live.current = { rect, innerW, innerH, onRect };
  const g = useRef({ d: 0, px: 0, py: 0, r: rect });
  const touch = {
    onStartShouldSetResponder: () => true,
    onTouchStart: (e: any) => {
      e.stopPropagation?.();
      const t = e.nativeEvent.touches;
      g.current = { d: t?.length === 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0, ...pt(e), r: live.current.rect };
      setActive(true);
    },
    onTouchMove: (e: any) => {
      e.stopPropagation?.();
      const t = e.nativeEvent.touches, r0 = g.current.r;
      if (t?.length === 2) {
        const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
        if (!g.current.d) { g.current.d = d; return; }
        const nw = clamp(r0.w / (d / g.current.d), 0.1, 1), nh = clamp((r0.h * nw) / r0.w, 0.1, 1);
        const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
        live.current.onRect({ w: nw, h: nh, x: clamp(cx - nw / 2, 0, 1 - nw), y: clamp(cy - nh / 2, 0, 1 - nh) });
        return;
      }
      const { px, py } = pt(e);
      live.current.onRect({ ...r0, x: clamp(r0.x - (px - g.current.px) / live.current.innerW, 0, 1 - r0.w),
                            y: clamp(r0.y - (py - g.current.py) / live.current.innerH, 0, 1 - r0.h) });
    },
    onTouchEnd: () => setActive(false),
    onTouchCancel: () => setActive(false),
  };
  return (
    <View {...touch} style={{ width: w, height: h, overflow: "hidden", backgroundColor: "#000" }}>
      <View pointerEvents="none" style={{ position: "absolute", left, top, width: innerW, height: innerH }}>
        <VideoView player={player} style={{ width: innerW, height: innerH }} contentFit="fill" nativeControls={false} playsInline />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: 4, top: 4, flexDirection: "row", alignItems: "center", gap: 3,
                                          backgroundColor: active ? c.accent : "rgba(0,0,0,0.55)", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
        <Icon name="move" size={9} color={active ? c.onAccent : "#fff"} />
        <Text style={withFont({ color: active ? c.onAccent : "#fff", fontSize: 8, fontWeight: "700" })}>{regionName(region)}</Text>
      </View>
      {active && <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderWidth: 2, borderColor: c.accent }} />}
    </View>
  );
}
const pt = (e: any) => point(e);

/** Обрезка краёв видео: тянешь белые полоски сверху, снизу и по бокам, формат кадра не меняется. */
type Cut = Project["crop"];
function CropEdges({ w, h, crop, onCrop }: { w: number; h: number; crop: Cut; onCrop: (c: Cut) => void }) {
  const live = useRef({ crop, onCrop });
  live.current = { crop, onCrop };
  const from = useRef({ px: 0, py: 0, c: crop });
  const MIN = 0.15; // меньше 15% кадра не оставляем
  const edge = (side: keyof Cut) => ({
    onStartShouldSetResponder: () => true,
    onTouchStart: (e: any) => { e.stopPropagation?.(); from.current = { ...point(e), c: live.current.crop }; },
    onTouchMove: (e: any) => {
      e.stopPropagation?.();
      const { px, py } = point(e), c0 = from.current.c;
      const dx = (px - from.current.px) / w, dy = (py - from.current.py) / h;
      const n = { ...c0 };
      if (side === "t") n.t = clamp(c0.t + dy, 0, 1 - c0.b - MIN);
      if (side === "b") n.b = clamp(c0.b - dy, 0, 1 - c0.t - MIN);
      if (side === "l") n.l = clamp(c0.l + dx, 0, 1 - c0.r - MIN);
      if (side === "r") n.r = clamp(c0.r - dx, 0, 1 - c0.l - MIN);
      live.current.onCrop(n);
    },
    onTouchEnd: (e: any) => e.stopPropagation?.(),
  });
  const L0 = crop.l * w, T0 = crop.t * h, W0 = (1 - crop.l - crop.r) * w, H0 = (1 - crop.t - crop.b) * h;
  const dim = "rgba(0,0,0,0.6)";
  const bar = (side: keyof Cut, style: any, horiz: boolean) => (
    <View testID={`crop-${side}`} {...edge(side)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={[{ position: "absolute", alignItems: "center", justifyContent: "center" }, style]}>
      <View style={{ width: horiz ? 34 : 5, height: horiz ? 5 : 34, borderRadius: 3, backgroundColor: "#fff" }} />
    </View>
  );
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: T0, backgroundColor: dim }} />
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: T0 + H0, bottom: 0, backgroundColor: dim }} />
      <View pointerEvents="none" style={{ position: "absolute", left: 0, width: L0, top: T0, height: H0, backgroundColor: dim }} />
      <View pointerEvents="none" style={{ position: "absolute", left: L0 + W0, right: 0, top: T0, height: H0, backgroundColor: dim }} />
      <View pointerEvents="none" style={{ position: "absolute", left: L0, top: T0, width: W0, height: H0, borderWidth: 2, borderColor: "#fff" }}>
        {[1, 2].map((i) => <View key={`v${i}`} style={{ position: "absolute", left: (W0 * i) / 3, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.35)" }} />)}
        {[1, 2].map((i) => <View key={`h${i}`} style={{ position: "absolute", top: (H0 * i) / 3, left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.35)" }} />)}
      </View>
      {/* ручки внутри рамки: снаружи их не достать, кадр обрезан по краям */}
      {bar("t", { left: L0 + Math.min(24, W0 / 4), width: Math.max(W0 - 48, W0 / 2), top: T0, height: 26, justifyContent: "flex-start", paddingTop: 3 }, true)}
      {bar("b", { left: L0 + Math.min(24, W0 / 4), width: Math.max(W0 - 48, W0 / 2), top: T0 + H0 - 26, height: 26, justifyContent: "flex-end", paddingBottom: 3 }, true)}
      {bar("l", { top: T0 + Math.min(26, H0 / 4), height: Math.max(H0 - 52, H0 / 2), left: L0, width: 26, alignItems: "flex-start", paddingLeft: 3 }, false)}
      {bar("r", { top: T0 + Math.min(26, H0 / 4), height: Math.max(H0 - 52, H0 / 2), left: L0 + W0 - 26, width: 26, alignItems: "flex-end", paddingRight: 3 }, false)}
    </View>
  );
}

/** Видео с обрезанными краями: остаётся только середина, остальное прозрачно. */
function CroppedVideo({ player, w, h, crop, fit }: { player: any; w: number; h: number; crop: Cut; fit: "cover" | "contain" }) {
  return (
    <View style={{ position: "absolute", left: crop.l * w, top: crop.t * h, width: (1 - crop.l - crop.r) * w, height: (1 - crop.t - crop.b) * h, overflow: "hidden" }}>
      <View style={{ position: "absolute", left: -crop.l * w, top: -crop.t * h, width: w, height: h }}>
        <VideoView player={player} style={{ width: w, height: h }} contentFit={fit} nativeControls={false} playsInline />
      </View>
    </View>
  );
}

/** Зоны, которые в TikTok и Reels закрыты кнопками и подписью: туда лучше не ставить текст. */
function SafeZones({ w, h }: { w: number; h: number }) {
  const z = "rgba(255,59,48,0.28)";
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: h * 0.08, backgroundColor: z }} />
      <View style={{ position: "absolute", right: 0, width: w * 0.16, top: h * 0.4, height: h * 0.44, backgroundColor: z }} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h * 0.16, backgroundColor: z }} />
      <Text style={withFont({ position: "absolute", left: 4, bottom: 3, color: "#fff", fontSize: 7, fontWeight: "700" })}>
        {L("Закрыто кнопками TikTok", "Covered by TikTok UI", "TikTok батырмалары жабады")}
      </Text>
    </View>
  );
}

/** Раскладывает надписи или наложения по дорожкам, чтобы они не лежали друг на друге. */
function lanes<T extends { from: number; to: number }>(items: T[]): T[][] {
  const out: T[][] = [];
  for (const it of items) {
    const lane = out.find((l) => l.every((x) => it.from >= x.to - 0.01 || it.to <= x.from + 0.01));
    if (lane) lane.push(it); else out.push([it]);
  }
  return out;
}

type Sel = { kind: "seg" | "text" | "layer"; id: string } | null;

/** Лента: куски клипов подряд, надписи, наложения, аудио, субтитры. Курсор всегда по центру. */
function Timeline(p: {
  proj: Project; total: number; pos: number; playing: boolean; sel: Sel; captions: { at: number; len: number; ch: Chunk }[];
  onScrub: (t: number) => void; onGrab: () => void; onZoom: (px: number) => void; onSelect: (s: Sel) => void;
  onTrim: (id: string, start: number, end: number) => void; scrollRef: React.RefObject<any>;
}) {
  const [w, setW] = useState(360);
  const [dragging, setDragging] = useState(false);
  const pinch = useRef(0);
  const ref = useRef(p);
  ref.current = p;
  const width = Math.max(p.total * PX, 1);
  const showTitle = !!p.proj.title && p.proj.aspect !== "16:9";
  type Row = { id: string; from: number; to: number; text: string; title?: boolean };
  const textLanes = lanes<Row>([...(showTitle ? [{ id: "title", from: 0, to: Math.min(3, p.total), text: p.proj.title, title: true }] : []), ...p.proj.texts]), layerLanes = lanes(p.proj.layers);
  const rows = Math.max(textLanes.length, 1) + 1 + layerLanes.length + p.proj.audios.length;

  // ручки обрезки выбранного куска
  const handles = useRef<Record<string, any>>({}).current;
  function handle(which: "start" | "end") {
    let from = 0, id = "";
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const sg = ref.current.proj.segs.find((x) => x.id === ref.current.sel?.id);
        if (!sg) return;
        id = sg.id;
        from = which === "start" ? sg.start : sg.end;
        setDragging(true);
        ref.current.onGrab();
      },
      onPanResponderMove: (_, g) => {
        const sg = ref.current.proj.segs.find((x) => x.id === id);
        if (!sg) return;
        const t = clamp(from + (g.dx / PX) * sp(sg), 0, fullOf(sg.clip)); // ручка двигается по ленте, а режет исходник
        if (which === "start") ref.current.onTrim(id, Math.min(t, sg.end - 0.5), sg.end);
        else ref.current.onTrim(id, sg.start, Math.max(t, sg.start + 0.5));
      },
      onPanResponderRelease: () => setDragging(false),
      onPanResponderTerminate: () => setDragging(false),
    });
  }
  if (!handles.start) { handles.start = handle("start"); handles.end = handle("end"); }

  const ticks = Array.from({ length: Math.floor(p.total) + 1 }, (_, i) => i);
  const labelEvery = PX < 22 ? 10 : PX < 40 ? 5 : PX < 90 ? 2 : 1;
  const block = (key: string, left: number, wid: number, color: string, label: string, icon?: IconName, onPress?: () => void, on?: boolean) => (
    <Pressable key={key} onPress={onPress}
               style={{ position: "absolute", left, width: Math.max(wid, 6), top: 0, bottom: 0, borderRadius: 5, backgroundColor: color,
                        flexDirection: "row", alignItems: "center", paddingHorizontal: 5, gap: 3, overflow: "hidden",
                        borderWidth: on ? 2 : 0, borderColor: "#fff" }}>
      {icon && <Icon name={icon} size={11} color="#fff" />}
      <Text numberOfLines={1} style={withFont({ color: "#fff", fontSize: 10, fontWeight: "600" })}>{label}</Text>
    </Pressable>
  );

  let at = 0;
  const segs = p.proj.segs.map((sg) => { const o = { sg, at }; at += segLen(sg); return o; });
  const selSeg = p.sel?.kind === "seg" ? segs.find((x) => x.sg.id === p.sel!.id) : undefined;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}
          style={{ height: 16 + STRIP_H + rows * 23 + 10 }}
          onTouchMove={(e) => {
            const t = e.nativeEvent.touches;
            if (!t || t.length !== 2) { pinch.current = 0; return; }
            const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
            if (pinch.current) p.onZoom(PX * (d / pinch.current));
            pinch.current = d;
          }}
          onTouchEnd={() => { pinch.current = 0; }}>
      <ScrollView
        ref={p.scrollRef} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={16} scrollEnabled={!dragging}
        onTouchStart={p.onGrab} onScrollBeginDrag={p.onGrab}
        onScroll={(e) => {
          if (ref.current.playing || dragging) return;
          p.onScrub(clamp(e.nativeEvent.contentOffset.x / PX, 0, ref.current.total));
        }}
        contentContainerStyle={{ paddingHorizontal: w / 2 }}
      >
        <View style={{ width, gap: 5 }}>
          <View style={{ height: 16 }}>
            {ticks.map((i) => (
              <View key={i} style={{ position: "absolute", left: i * PX, top: 0 }}>
                {i % labelEvery === 0
                  ? <Text style={withFont({ color: c.dim, fontSize: 10, marginLeft: -8 })}>{clock(i)}</Text>
                  : PX >= 14 ? <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: c.dim, marginTop: 6 }} /> : null}
              </View>
            ))}
          </View>

          {/* куски видео */}
          <View style={{ height: STRIP_H }}>
            {segs.map(({ sg, at }) => {
              const wid = segLen(sg) * PX;
              const on = selSeg?.sg.id === sg.id;
              return (
                <Pressable key={sg.id} onPress={() => p.onSelect(on ? null : { kind: "seg", id: sg.id })}
                           style={{ position: "absolute", left: at * PX + 1, width: Math.max(wid - 2, 4), height: STRIP_H,
                                    borderRadius: 6, overflow: "hidden", backgroundColor: c.raised }}>
                  <Frames clip={sg.clip} start={sg.start} width={wid} speed={sp(sg)} />
                  {sg.clip.moment != null && sg.clip.moment > sg.start && sg.clip.moment < sg.end && (
                    <View style={{ position: "absolute", left: ((sg.clip.moment - sg.start) * PX) / sp(sg), width: 2, top: 0, bottom: 0, backgroundColor: "#FFE500" }} />
                  )}
                  {sp(sg) !== 1 && (
                    <View style={{ position: "absolute", left: 4, top: 4, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 4, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 2 }}>
                      <Icon name="speedometer-outline" size={10} color="#fff" />
                      <Text style={withFont({ color: "#fff", fontSize: 9, fontWeight: "700" })}>{sp(sg)}x</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {/* ключевые кадры масштаба */}
            {p.proj.keys.map((k) => (
              <View key={k.id} pointerEvents="none" style={{ position: "absolute", left: k.t * PX - 5, bottom: -5, width: 10, height: 10,
                                                             backgroundColor: "#FFE500", borderWidth: 1.5, borderColor: "#000", transform: [{ rotate: "45deg" }] }} />
            ))}
            {selSeg && (
              <>
                <View pointerEvents="none" style={{ position: "absolute", left: selSeg.at * PX, width: segLen(selSeg.sg) * PX, top: -2, bottom: -2,
                                                    borderWidth: 2, borderColor: "#fff", borderRadius: 6 }} />
                {(["start", "end"] as const).map((k) => (
                  <View key={k} {...handles[k].panHandlers} hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }}
                        style={{ position: "absolute", left: k === "start" ? selSeg.at * PX - HANDLE : (selSeg.at + segLen(selSeg.sg)) * PX,
                                 top: -2, bottom: -2, width: HANDLE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
                                 borderTopLeftRadius: k === "start" ? 6 : 0, borderBottomLeftRadius: k === "start" ? 6 : 0,
                                 borderTopRightRadius: k === "end" ? 6 : 0, borderBottomRightRadius: k === "end" ? 6 : 0 }}>
                    <Icon name={k === "start" ? "chevron-back" : "chevron-forward"} size={13} color="#000" />
                  </View>
                ))}
              </>
            )}
          </View>

          {/* свои надписи и заголовок */}
          {(textLanes.length ? textLanes : [[]]).map((lane, li) => (
            <View key={`t${li}`} style={{ height: 18 }}>
              {lane.map((t) => t.title ? block("title", 0, t.to * PX, "#E8792B", t.text, "megaphone") : block(t.id, t.from * PX, (t.to - t.from) * PX, "#D9467A", t.text || L("Текст", "Text"), "text",
                                     () => p.onSelect({ kind: "text", id: t.id }), p.sel?.id === t.id))}
            </View>
          ))}
          {/* субтитры */}
          <View style={{ height: 18, opacity: p.proj.subtitles && p.proj.aspect !== "16:9" ? 1 : 0.35 }}>
            {p.captions.map(({ at, len, ch }, i) => block(`c${i}`, at * PX + 1, len * PX - 2, "#8E5CF6", ch.text))}
          </View>
          {/* наложения */}
          {layerLanes.map((lane, li) => (
            <View key={`l${li}`} style={{ height: 18 }}>
              {lane.map((l) => block(l.id, l.from * PX, (l.to - l.from) * PX, l.hidden ? "#3A4A60" : "#2F7BE0", l.name, l.hidden ? "eye-off" : l.locked ? "lock-closed" : l.kind === "video" ? "film" : "image",
                                     () => p.onSelect({ kind: "layer", id: l.id }), p.sel?.id === l.id))}
            </View>
          ))}
          {/* аудио */}
          {p.proj.audios.map((a) => (
            <View key={a.id} style={{ height: 18 }}>
              {block(a.id, 0, p.total * PX, a.muted ? "#35524A" : "#1E9E6A", `${a.name} · ${a.muted ? L("без звука", "muted", "дыбыссыз") : `${Math.round(a.volume * 100)}%`}`, a.muted ? "volume-mute" : "musical-notes")}
            </View>
          ))}
        </View>
      </ScrollView>
      <View pointerEvents="none" style={{ position: "absolute", left: w / 2 - 1, top: 18, bottom: 0, width: 2, backgroundColor: c.fg, borderRadius: 1 }} />
      <View pointerEvents="none" style={{ position: "absolute", left: w / 2 - 5, top: 14, width: 10, height: 10, borderRadius: 5, backgroundColor: c.fg }} />
    </View>
  );
}

/** Шрифт для превью: свой загруженный или шрифт приложения. */
const fontFamily = (proj: Project, id?: string | null) => {
  const own = proj.fonts.find((f) => f.id === id);
  return own ? `custom_${own.id}` : FONT.headingBlack;
};

/** Превью: видео в выбранном формате и шаблоне. Щипок — масштаб, палец — сдвиг, всё поверх двигается. */
function Preview({ player, camPlayer, proj, pos, tf, chunk, sample, sel, safe, editing, cropping, onSelect, onChange, onTransform }:
  { player: any; camPlayer: any; proj: Project; pos: number; tf: { zoom: number; panX: number; panY: number };
    chunk: Chunk | null; sample: Chunk | null; sel: Sel; safe: boolean; editing: boolean; cropping: boolean;
    onSelect: (s: Sel) => void; onChange: (patch: Partial<Project>) => void; onTransform: (x: { zoom?: number; panX?: number; panY?: number }) => void }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ratio = ASPECTS.find((a) => a.id === proj.aspect)!.r;
  const h = Math.min(box.h, box.w / ratio), w = h * ratio;
  const textOk = proj.aspect !== "16:9";
  const st = proj.style;
  const shown = chunk ?? sample;
  const words = shown ? shown.text.split(/\s+/).filter(Boolean) : [];
  const step = shown ? (shown.end - shown.start) / Math.max(words.length, 1) : 1;
  const now = chunk ? Math.floor((pos - chunk.start) / step) : -1;
  const live = useRef(proj);
  live.current = proj;
  const liveTf = useRef(tf);
  liveTf.current = tf;
  const patch = (x: Partial<Project>) => onChange(x);
  const layout = proj.aspect === "9:16" ? LAYOUTS().find((l) => l.id === proj.layout) : undefined;
  const split = layout && layout.areas.length > 0;

  // щипок — масштаб видео, один палец при увеличении — сдвиг
  // Видео двигается руками: один палец — сдвиг, два пальца — размер и поворот,
  // круглая ручка в углу — то же самое одним пальцем (удобно и мышкой)
  const [touching, setTouching] = useState(false);
  const frame = useRef<any>(null);
  const origin = useRef({ x: 0, y: 0 });
  const g = useRef({ d: 0, a: 0, px: 0, py: 0, zoom: 1, panX: 0, panY: 0, rot: 0 });
  const two = (t: any) => ({ d: Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY),
                             a: (Math.atan2(t[1].pageY - t[0].pageY, t[1].pageX - t[0].pageX) * 180) / Math.PI });
  // поворот прилипает к 0, 90, 180, чтобы легко выровнять
  const snap = (r: number) => {
    r = ((r + 540) % 360) - 180;
    for (const s0 of [-180, -90, 0, 90, 180]) if (Math.abs(r - s0) < 4) return s0 === -180 ? 180 : s0;
    return Math.round(r);
  };
  const start = (e: any) => {
    const t = e.nativeEvent.touches;
    const { px, py } = point(e);
    const m = t?.length === 2 ? two(t) : { d: 0, a: 0 };
    g.current = { ...m, px, py, ...liveTf.current, rot: live.current.rotate };
    setTouching(true);
  };
  const bg = split || cropping ? {} : {
    onTouchStart: start,
    onTouchMove: (e: any) => {
      const t = e.nativeEvent.touches;
      if (t?.length === 2) {
        const m = two(t);
        if (!g.current.d) { g.current = { ...g.current, ...m }; return; }
        onTransform({ zoom: clamp(g.current.zoom * (m.d / g.current.d), 0.3, 4) });
        const rot = snap(g.current.rot + (m.a - g.current.a));
        if (rot !== live.current.rotate) onChange({ rotate: rot });
        return;
      }
      const { px, py } = point(e);
      onTransform({ panX: clamp(g.current.panX + (px - g.current.px) / w, -1, 1), panY: clamp(g.current.panY + (py - g.current.py) / h, -1, 1) });
    },
    onTouchEnd: () => setTouching(false),
    onTouchCancel: () => setTouching(false),
  };

  // где сейчас видео: центр, размер и угол — для рамки и ручки
  const cx = w / 2 + tf.panX * w, cy = h / 2 + tf.panY * h;
  const rad = (proj.rotate * Math.PI) / 180;
  const hx = (w / 2) * tf.zoom, hy = (h / 2) * tf.zoom;
  const cornerX = cx + hx * Math.cos(rad) - hy * Math.sin(rad), cornerY = cy + hx * Math.sin(rad) + hy * Math.cos(rad);
  const knob = { x: clamp(cornerX, 16, w - 16), y: clamp(cornerY, 16, h - 16) };
  const handle = {
    onStartShouldSetResponder: () => true,
    onTouchStart: (e: any) => {
      e.stopPropagation?.();
      frame.current?.measureInWindow?.((x: number, y: number) => { origin.current = { x, y }; });
      const { px, py } = point(e);
      g.current = { d: 0, a: 0, px, py, ...liveTf.current, rot: live.current.rotate };
      setTouching(true);
    },
    onTouchMove: (e: any) => {
      e.stopPropagation?.();
      const { px, py } = point(e);
      const c0x = origin.current.x + w / 2 + g.current.panX * w, c0y = origin.current.y + h / 2 + g.current.panY * h;
      const d = Math.hypot(px - c0x, py - c0y), a = (Math.atan2(py - c0y, px - c0x) * 180) / Math.PI;
      if (!g.current.d) { g.current.d = d; g.current.a = a; return; }
      onTransform({ zoom: clamp(g.current.zoom * (d / Math.max(g.current.d, 1)), 0.3, 4) });
      const rot = snap(g.current.rot + (a - g.current.a));
      if (rot !== live.current.rotate) onChange({ rotate: rot });
    },
    onTouchEnd: (e: any) => { e.stopPropagation?.(); setTouching(false); },
    onTouchCancel: () => setTouching(false),
  };
  const showBox = !split && !cropping && (editing || touching);
  const fitMode = proj.fit === "fit" || ratio >= 1.7 ? "contain" : "cover";
  const cut = proj.crop ?? { l: 0, t: 0, r: 0, b: 0 };

  const base = Math.max(7, w / 15);
  const capSince = chunk ? pos - chunk.start : 1;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && (
        <View ref={frame} {...bg} style={{ width: w, height: h, backgroundColor: "#000", overflow: "hidden", borderRadius: 4,
                                           ...(Platform.OS === "web" ? ({ touchAction: "none" } as any) : null) /* браузер не забирает жест себе */ }}>
          {split ? (
            <View style={{ width: w, height: h }}>
              {layout!.band ? <View style={{ height: h * layout!.band, backgroundColor: "#fff" }} /> : null}
              {layout!.areas.map((a, i) => (
                <Crop key={`${proj.layout}${i}`} player={i === 0 ? player : camPlayer} rect={proj.regions[a.region]} w={w} h={h * a.h} region={a.region}
                      onRect={(r) => patch({ regions: { ...live.current.regions, [a.region]: r } })} />
              ))}
            </View>
          ) : (
            // при обрезке видео показывается ровно, без масштаба и поворота, чтобы видеть края
            <View pointerEvents="none" style={{ width: w, height: h, transform: cropping ? [] : [{ translateX: tf.panX * w }, { translateY: tf.panY * h }, { scale: tf.zoom }, { rotate: `${proj.rotate}deg` }] }}>
              <CroppedVideo player={player} w={w} h={h} crop={cropping ? { l: 0, t: 0, r: 0, b: 0 } : cut} fit={fitMode} />
            </View>
          )}
          {cropping && !split && <CropEdges w={w} h={h} crop={cut} onCrop={(crop) => patch({ crop })} />}

          {!cropping && proj.layers.filter((l) => !l.hidden && pos >= l.from && pos <= l.to).map((l) => {
            const lw = l.scale * w, lh = lw / (l.ratio || 1);
            return (
              <Movable key={l.id} x={l.x} y={l.y} w={w} h={h} selected={sel?.id === l.id} locked={l.locked} onTap={() => onSelect({ kind: "layer", id: l.id })}
                       onMove={(x, y) => patch({ layers: live.current.layers.map((z) => (z.id === l.id ? { ...z, x, y } : z)) })}>
                <View style={{ opacity: l.opacity ?? 1, borderRadius: (l.radius ?? 0) * Math.min(lw, lh), overflow: "hidden" }}>
                  {l.kind === "video"
                    ? <OverlayVideo uri={l.uri} width={lw} height={lh} />
                    : <Image source={{ uri: l.uri }} style={{ width: lw, height: lh }} contentFit="contain" autoplay />}
                </View>
              </Movable>
            );
          })}

          {!cropping && textOk && proj.title ? (
            <Movable x={st.title_x ?? 0.5} y={st.title_y ?? 0.13} w={w} h={h}
                     onMove={(x, y) => patch({ style: { ...live.current.style, title_x: x, title_y: y } })}>
              <Text style={{ fontFamily: fontFamily(proj, st.font), color: st.title_color ?? DEFAULT_COLORS.title, fontSize: base,
                             textAlign: "center", ...(proj.layout === "meme" && proj.aspect === "9:16" ? {} : textFx(st.stroke, st.shadow)) }}>
                {proj.title.toUpperCase()}
              </Text>
            </Movable>
          ) : null}

          {!cropping && textOk && proj.subtitles && shown ? (
            <Movable x={st.caption_x ?? 0.5} y={st.caption_y ?? 0.75} w={w} h={h} faded={!chunk}
                     onMove={(x, y) => patch({ style: { ...live.current.style, caption_x: x, caption_y: y } })}>
              <View style={animFx(st.anim, capSince)}>
                <Text style={{ fontFamily: fontFamily(proj, st.font), fontSize: base * 1.1, textAlign: "center", ...textFx(st.stroke, st.shadow) }}>
                  {words.map((wd, i) => (
                    <Text key={i} style={{ color: i === now ? st.word_color ?? DEFAULT_COLORS.word : st.text_color ?? DEFAULT_COLORS.text }}>
                      {st.upper === false ? wd : wd.toUpperCase()}{i < words.length - 1 ? " " : ""}
                    </Text>
                  ))}
                </Text>
              </View>
            </Movable>
          ) : null}

          {!cropping && proj.texts.filter((t) => pos >= t.from && pos <= t.to).map((t) => (
            <Movable key={t.id} x={t.x} y={t.y} w={w} h={h} selected={sel?.id === t.id} onTap={() => onSelect({ kind: "text", id: t.id })}
                     onMove={(x, y) => patch({ texts: live.current.texts.map((z) => (z.id === t.id ? { ...z, x, y } : z)) })}>
              <View style={animFx(t.anim, pos - t.from)}>
                <Text style={{ fontFamily: fontFamily(proj, t.font), color: t.color, fontSize: base * t.size, textAlign: "center", ...textFx(t.stroke, t.shadow) }}>
                  {t.text || " "}
                </Text>
              </View>
            </Movable>
          ))}

          {safe && proj.aspect === "9:16" && <SafeZones w={w} h={h} />}

          {showBox && (
            <>
              <View pointerEvents="none" style={{ position: "absolute", left: cx - hx, top: cy - hy, width: hx * 2, height: hy * 2,
                                                  borderWidth: 1.5, borderColor: c.accent, transform: [{ rotate: `${proj.rotate}deg` }] }} />
              {touching && (
                <View pointerEvents="none" style={{ position: "absolute", top: 6, alignSelf: "center", left: 0, right: 0, alignItems: "center" }}>
                  <View style={{ backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={withFont({ color: "#fff", fontSize: 10, fontWeight: "700" })}>{Math.round(tf.zoom * 100)}% · {proj.rotate}°</Text>
                  </View>
                </View>
              )}
              <View testID="video-knob" {...handle} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={{ position: "absolute", left: knob.x - 13, top: knob.y - 13, width: 26, height: 26, borderRadius: 13,
                             backgroundColor: c.accent, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" }}>
                <Icon name="sync" size={13} color={c.onAccent} />
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

/** − 70% + */
function Stepper({ value, onChange, step = 0.1, min = 0, max = 1, fmt }:
  { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; fmt?: (v: number) => string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Pressable hitSlop={8} onPress={() => onChange(clamp(+(value - step).toFixed(2), min, max))}
                 style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
        <Icon name="remove" size={18} />
      </Pressable>
      <P style={{ width: 54, textAlign: "center", fontWeight: "700", fontSize: 14 }}>{fmt ? fmt(value) : `${Math.round(value * 100)}%`}</P>
      <Pressable hitSlop={8} onPress={() => onChange(clamp(+(value + step).toFixed(2), min, max))}
                 style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
        <Icon name="add" size={18} />
      </Pressable>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={[s.row, { minHeight: 40 }]}>
      <P dim style={{ fontSize: 13, flex: 1 }}>{label}</P>
      {children}
    </View>
  );
}

/** Выбор клипа, чтобы добавить его на ленту ещё одним куском. */
function ClipPicker({ onPick, onClose }: { onPick: (c: Clip) => void; onClose: () => void }) {
  const [list, setList] = useState<Clip[] | null>(null);
  useEffect(() => { api.clips().then(setList).catch(() => setList([])); }, []);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: TOP, paddingHorizontal: 16 }}>
      <View style={[s.row, { height: 48 }]}>
        <P style={{ fontWeight: "700", fontSize: 17 }}>{L("Добавить момент", "Add a moment", "Сәт қосу")}</P>
        <Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={26} /></Pressable>
      </View>
      {!list ? <ActivityIndicator color={c.accent} /> : (
        <FlatList data={list} keyExtractor={(x) => x.id} numColumns={2} columnWrapperStyle={{ gap: 10 }} contentContainerStyle={{ gap: 12 }}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => onPick(item)} style={{ flex: 1 / 2, gap: 6 }}>
                      <View style={{ aspectRatio: 16 / 9, borderRadius: 10, overflow: "hidden", backgroundColor: c.raised }}>
                        {item.thumb && <Image source={{ uri: withToken(item.thumb) }} style={{ flex: 1 }} contentFit="cover" />}
                      </View>
                      <P numberOfLines={1} style={{ fontSize: 13, fontWeight: "600" }}>{item.title ?? item.channel}</P>
                    </Pressable>
                  )} />
      )}
    </View>
  );
}

type Tool = "video" | "text" | "captions" | "layers" | "audio" | "ai" | "templates" | "format" | "title" | "font" | "export";
const tools = (): [Tool, string, IconName][] => [
  ["video", L("Видео", "Video", "Видео"), "film-outline"],
  ["text", L("Текст", "Text", "Мәтін"), "text-outline"],
  ["captions", L("Субтитры", "Captions", "Субтитрлер"), "chatbox-ellipses-outline"],
  ["layers", L("Слои", "Layers", "Қабаттар"), "layers-outline"],
  ["audio", L("Аудио", "Audio", "Аудио"), "musical-notes-outline"],
  ["ai", L("AI", "AI", "AI"), "sparkles-outline"],
  ["templates", L("Шаблоны", "Templates", "Үлгілер"), "grid-outline"],
  ["format", L("Формат", "Format", "Формат"), "crop-outline"],
  ["title", L("Заголовок", "Title", "Тақырып"), "megaphone-outline"],
  ["font", L("Шрифт", "Font", "Қаріп"), "color-palette-outline"],
];

/** Маленькая кнопка-иконка с подписью для панелей. */
function IconBtn({ icon, label, onPress, on, off }: { icon: IconName; label: string; onPress: () => void; on?: boolean; off?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={off}
               style={{ flex: 1, minWidth: 64, height: 58, borderRadius: 10, backgroundColor: on ? c.fg : c.raised, alignItems: "center", justifyContent: "center", gap: 3, opacity: off ? 0.35 : 1 }}>
      <Icon name={icon} size={19} color={on ? c.bg : c.fg} />
      <Text numberOfLines={1} style={withFont({ color: on ? c.bg : c.fg, fontSize: 10, fontWeight: "600" })}>{label}</Text>
    </Pressable>
  );
}

export default function Editor({ clip, project, me, onClose }: { clip?: Clip; project?: Project; me: Me | null; onClose: () => void }) {
  const canVertical = !!me?.plan?.vertical;
  const maxLen = me?.plan?.max_seconds ?? 30;
  const maxQ = me?.plan?.height ?? 720;
  const [proj, setProj] = useState<Project>(() => fixProject(project ?? { ...newProject([{ clip: clip! }], maxLen, canVertical), quality: Math.min(maxQ, 1080) }));
  const [dirty, setDirty] = useState(false);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [safe, setSafe] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const myPresets = usePresets();
  const [zoom, setZoomState] = useState(56);
  PX = zoom;
  const scrollRef = useRef<any>(null);
  const win = useWindowDimensions();

  // история для «Отменить» и «Вернуть»: быстрые изменения подряд (перетаскивание) — один шаг
  const projRef = useRef(proj);
  projRef.current = proj;
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const lastPush = useRef(0);
  const update = (patch: Partial<Project>) => {
    const now = Date.now();
    if (now - lastPush.current > 600) {
      past.current.push(projRef.current);
      if (past.current.length > 80) past.current.shift();
    }
    lastPush.current = now;
    future.current = [];
    setProj((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(projRef.current);
    lastPush.current = 0;
    setProj(prev);
    setDirty(true);
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(projRef.current);
    lastPush.current = 0;
    setProj(next);
    setDirty(true);
  }
  const setStyle = (st: Style) => update({ style: st });
  const say = (m: string) => { setNote(m); setTimeout(() => setNote((x) => (x === m ? null : x)), 2800); };

  // сохраняем проект, как только человек что-то поменял
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => projects.save(proj), 400);
    return () => clearTimeout(id);
  }, [proj, dirty]);

  // свои шрифты подгружаем для превью
  useEffect(() => {
    proj.fonts.forEach((f) => Font.loadAsync({ [`custom_${f.id}`]: f.uri }).catch(() => null));
  }, [proj.fonts.length]);

  const lay = useMemo(() => {
    let at = 0;
    return proj.segs.map((sg) => { const o = { sg, at }; at += segLen(sg); return o; });
  }, [proj.segs]);
  const total = lay.reduce((a, x) => a + segLen(x.sg), 0);
  const locate = (t: number) => {
    let i = lay.length - 1;
    for (let k = 0; k < lay.length; k++) if (t < lay[k].at + segLen(lay[k].sg)) { i = k; break; }
    const o = lay[Math.max(i, 0)];
    return { i: Math.max(i, 0), sg: o.sg, local: o.sg.start + clamp(t - o.at, 0, segLen(o.sg)) * sp(o.sg) };
  };

  // второй плеер нужен шаблонам, где в кадре два окна одного стрима (вебка и игра)
  const player = useVideoPlayer(withToken(proj.segs[0].clip.video), (pl) => { pl.loop = false; });
  const camPlayer = useVideoPlayer(withToken(proj.segs[0].clip.video), (pl) => { pl.loop = false; pl.muted = true; });
  const src = useRef(proj.segs[0].clip.video);
  const cur = useRef(0);
  const live = useRef({ playing, lay, total });
  live.current = { playing, lay, total };
  useEffect(() => { player.volume = proj.clipVolume; }, [proj.clipVolume, player]);

  function setSource(cl: Clip) {
    if (src.current === cl.video) return;
    src.current = cl.video;
    player.replaceAsync(withToken(cl.video)).catch(() => null);
    camPlayer.replaceAsync(withToken(cl.video)).catch(() => null);
  }
  function setRate(r: number) {
    try { player.playbackRate = r; camPlayer.playbackRate = r; } catch {}
  }

  // пока играет: лента едет, куски идут один за другим, удалённые места пропускаются
  useEffect(() => {
    const id = setInterval(() => {
      const { playing, lay, total } = live.current;
      if (!playing || !lay.length) return;
      const o = lay[Math.min(cur.current, lay.length - 1)];
      const local = player.currentTime;
      let t = o.at + (local - o.sg.start) / sp(o.sg);
      if (local >= o.sg.end - 0.04) {
        if (cur.current + 1 < lay.length) {
          cur.current += 1;
          const n = lay[cur.current];
          setSource(n.sg.clip);
          setRate(sp(n.sg));
          player.currentTime = n.sg.start;
          camPlayer.currentTime = n.sg.start;
          player.play();
          t = n.at;
        } else {
          player.pause();
          camPlayer.pause();
          setPlaying(false);
          t = total;
        }
      }
      // вебка идёт вместе с основным видео
      if (Math.abs(camPlayer.currentTime - player.currentTime) > 0.25) camPlayer.currentTime = player.currentTime;
      if (!camPlayer.playing && player.playing) camPlayer.play();
      setPos(t);
      scrollRef.current?.scrollTo({ x: t * PX, animated: false });
    }, 50);
    return () => clearInterval(id);
  }, [player]);

  function seek(t: number, scroll = true) {
    t = clamp(t, 0, total);
    const { i, sg, local } = locate(t);
    cur.current = i;
    setSource(sg.clip);
    setRate(sp(sg));
    player.currentTime = local;
    camPlayer.currentTime = local;
    setPos(t);
    if (scroll) scrollRef.current?.scrollTo({ x: t * PX, animated: false });
  }
  function pause() {
    if (live.current.playing) { player.pause(); camPlayer.pause(); setPlaying(false); }
  }
  function toggle() {
    if (playing) return pause();
    if (pos >= total - 0.05) seek(0);
    else seek(pos, false);
    player.play();
    camPlayer.play();
    setPlaying(true);
  }
  function setZoom(px: number) {
    const z = clamp(px, ZOOM_MIN, ZOOM_MAX);
    setZoomState(z);
    setTimeout(() => scrollRef.current?.scrollTo({ x: pos * z, animated: false }), 0);
  }

  // масштаб видео: без ключевых кадров — один на весь ролик, с ними — правится кадр под курсором
  const tf = tfAt(proj, pos);
  function setTransform(x: { zoom?: number; panX?: number; panY?: number }) {
    const p = projRef.current;
    if (!p.keys.length) return update({ ...x, ...(p.layout !== "full" ? { layout: "full" as LayoutId } : null) });
    const curTf = tfAt(p, pos);
    const near = p.keys.find((k) => Math.abs(k.t - pos) < 0.15);
    const k: Key = { id: near?.id ?? uid(), t: near?.t ?? pos, zoom: curTf.zoom, panX: curTf.panX, panY: curTf.panY, ...x };
    update({ keys: [...p.keys.filter((y) => y.id !== k.id), k].sort((a, b) => a.t - b.t) });
  }
  const keyHere = proj.keys.find((k) => Math.abs(k.t - pos) < 0.15);

  // субтитры: куски по клипам, исправления хранятся в проекте
  const chunksOf = (cl: Clip): Chunk[] => proj.captions?.[cl.id] ?? toChunks(cl.words ?? []);
  const captions = useMemo(() => lay.flatMap(({ sg, at }) =>
    chunksOf(sg.clip).filter((ch) => ch.end > sg.start && ch.start < sg.end)
      .map((ch) => ({ at: at + (Math.max(ch.start, sg.start) - sg.start) / sp(sg), len: (Math.min(ch.end, sg.end) - Math.max(ch.start, sg.start)) / sp(sg), ch }))),
  [lay, proj.captions]);
  const here = locate(pos);
  const chunk = chunksOf(here.sg.clip).find((ch) => here.local >= ch.start && here.local < ch.end) ?? null;
  const sample = captions[0]?.ch ?? null;
  const chunkNow = chunk ? { ...chunk, start: pos - (here.local - chunk.start) / sp(here.sg), end: pos + (chunk.end - here.local) / sp(here.sg) } : null;

  // --- действия ---
  function pickTool(t: Tool) {
    pause();
    if (proj.aspect === "16:9" && (t === "title" || t === "captions")) {
      say(L("В 16:9 нет заголовка и субтитров. Открой «Формат» и выбери 9:16.", "No title or captions in 16:9. Open Format and pick 9:16."));
      return;
    }
    setTool(tool === t ? null : t);
  }

  function split() {
    const { sg, local } = locate(pos);
    if (local - sg.start < 0.3 || sg.end - local < 0.3) return say(L("Поставь курсор внутри куска", "Put the cursor inside a piece", "Курсорды кесіндінің ішіне қой"));
    const a = { ...sg, id: uid(), end: local }, b = { ...sg, id: uid(), start: local };
    update({ segs: proj.segs.flatMap((x) => (x.id === sg.id ? [a, b] : [x])) });
    setSel({ kind: "seg", id: b.id });
  }
  function removeSeg(id: string) {
    if (proj.segs.length < 2) return say(L("Это последний кусок", "This is the last piece", "Бұл соңғы кесінді"));
    update({ segs: proj.segs.filter((x) => x.id !== id) });
    setSel(null);
    setTimeout(() => seek(0), 0);
  }
  function moveSeg(id: string, dir: -1 | 1) {
    const i = proj.segs.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= proj.segs.length) return;
    const segs = [...proj.segs];
    [segs[i], segs[j]] = [segs[j], segs[i]];
    update({ segs });
  }
  function dupSeg(id: string) {
    const sg = proj.segs.find((x) => x.id === id);
    if (!sg) return;
    if (total + segLen(sg) > maxLen + 0.05) return say(L(`Будет длиннее ${maxLen} сек — лимит тарифа`, `Would be longer than ${maxLen} s`));
    const copy = { ...sg, id: uid() };
    update({ segs: proj.segs.flatMap((x) => (x.id === id ? [x, copy] : [x])) });
    setSel({ kind: "seg", id: copy.id });
  }
  // соседние куски одного клипа, которые идут встык, можно снова склеить
  const mergeable = (id: string) => {
    const i = proj.segs.findIndex((x) => x.id === id), a = proj.segs[i], b = proj.segs[i + 1];
    return !!a && !!b && a.clip.id === b.clip.id && Math.abs(a.end - b.start) < 0.05 && sp(a) === sp(b);
  };
  function mergeNext(id: string) {
    const i = proj.segs.findIndex((x) => x.id === id), a = proj.segs[i], b = proj.segs[i + 1];
    update({ segs: [...proj.segs.slice(0, i), { ...a, end: b.end }, ...proj.segs.slice(i + 2)] });
  }
  function setSpeed(id: string, speed: number) {
    const sg = proj.segs.find((x) => x.id === id)!;
    const longer = total - segLen(sg) + (sg.end - sg.start) / speed;
    if (longer > maxLen + 0.05) return say(L(`Замедленный ролик будет длиннее ${maxLen} сек. Сначала обрежь.`, `Slowed video would exceed ${maxLen} s. Trim first.`));
    update({ segs: proj.segs.map((x) => (x.id === id ? { ...x, speed } : x)) });
  }
  function addMoment(cl: Clip) {
    setPicking(false);
    const full = fullOf(cl);
    const room = Math.max(maxLen - total, 1);
    const sg: Seg = { id: uid(), clip: cl, start: 0, end: Math.min(full, 15, room) };
    update({ segs: [...proj.segs, sg] });
    setSel({ kind: "seg", id: sg.id });
  }

  function addText() {
    const t: TextLayer = { id: uid(), text: L("Твой текст", "Your text", "Мәтінің"), color: "#FFFFFF", size: 1, x: 0.5,
                           y: 0.3 + (proj.texts.length % 5) * 0.12, // новая надпись не ложится поверх старой
                           from: pos, to: Math.min(total, pos + 3), stroke: true, anim: "pop" };
    if (t.to - t.from < 1) { t.from = 0; t.to = total; }
    update({ texts: [...proj.texts, t] });
    setSel({ kind: "text", id: t.id });
  }
  const editText = (id: string, x: Partial<TextLayer>) => update({ texts: proj.texts.map((t) => (t.id === id ? { ...t, ...x } : t)) });
  const editLayer = (id: string, x: Partial<Layer>) => update({ layers: proj.layers.map((t) => (t.id === id ? { ...t, ...x } : t)) });
  const editAudio = (id: string, x: Partial<AudioTrack>) => update({ audios: proj.audios.map((t) => (t.id === id ? { ...t, ...x } : t)) });
  function moveLayer(id: string, dir: -1 | 1) {
    const i = proj.layers.findIndex((x) => x.id === id), j = i + dir;
    if (j < 0 || j >= proj.layers.length) return;
    const layers = [...proj.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    update({ layers });
  }
  function dupLayer(id: string) {
    const l = proj.layers.find((x) => x.id === id)!;
    const copy = { ...l, id: uid(), x: clamp(l.x + 0.06, 0.05, 0.95), y: clamp(l.y + 0.06, 0.05, 0.95) };
    update({ layers: [...proj.layers, copy] });
    setSel({ kind: "layer", id: copy.id });
  }

  // --- шаблоны ---
  function applyLayout(id: LayoutId) {
    if (!canVertical) return say(L("Шаблоны 9:16 есть на Creator и выше", "9:16 templates are on Creator and above"));
    const l = LAYOUTS().find((x) => x.id === id)!;
    const base = id === "meme" ? {} : { title_color: proj.style.title_color === "#000000" ? undefined : proj.style.title_color };
    update({ layout: id, aspect: "9:16", style: { ...proj.style, ...base, ...(l.style ?? {}) },
             ...(id === "podcast" ? { style: { ...proj.style, ...CAPTION_PRESETS().find((x) => x.id === "podcast")!.style, ...l.style } } : null) });
  }
  function camCorner(corner: "tl" | "tr" | "bl" | "br") {
    const r = proj.regions.cam;
    update({ regions: { ...proj.regions, cam: { ...r, x: corner.endsWith("l") ? 0 : 1 - r.w, y: corner.startsWith("t") ? 0 : 1 - r.h } } });
  }
  function savePreset() {
    const name = presetName.trim() || L("Мой шаблон", "My template", "Менің үлгім") + ` ${myPresets.length + 1}`;
    presets.save({ id: uid(), name, aspect: proj.aspect, layout: proj.layout, regions: proj.regions, style: proj.style, subtitles: proj.subtitles });
    setPresetName("");
    say(L("Шаблон сохранён. Его можно применить к любому клипу.", "Template saved. Apply it to any clip."));
  }

  // --- AI ---
  /** Плавно приближает к самому яркому моменту клипа и отдаляет обратно. */
  function autoZoom() {
    const keys: Key[] = [];
    for (const { sg, at } of lay) {
      const m = sg.clip.moment != null && sg.clip.moment > sg.start && sg.clip.moment < sg.end ? sg.clip.moment : (sg.start + sg.end) / 2;
      const tm = at + (m - sg.start) / sp(sg), len = segLen(sg);
      const pts: [number, number][] = [[tm - 1.6, 1], [tm - 0.4, 1.45], [tm + 1.4, 1.45], [tm + 2.4, 1]];
      pts.filter(([t]) => t >= at && t <= at + len).forEach(([t, z]) => keys.push({ id: uid(), t: +t.toFixed(2), zoom: z, panX: 0, panY: 0 }));
    }
    if (!keys.length) return say(L("Кусок слишком короткий для зума", "Too short for a zoom"));
    update({ keys: keys.sort((a, b) => a.t - b.t), layout: "full" });
    say(L(`Добавил зум к ярким моментам: ${keys.length} ключевых кадров`, `Added zoom to the moments: ${keys.length} keyframes`));
  }
  /** Вырезает паузы длиннее секунды, где стример молчит (по распознанной речи). */
  function removeSilence() {
    let cut = 0, n = 0;
    const segs: Seg[] = [];
    for (const sg of proj.segs) {
      const words = (sg.clip.words ?? []).filter((w) => w[1] > sg.start && w[0] < sg.end);
      if (!words.length) { segs.push(sg); continue; }
      let from = sg.start;
      const pad = 0.25;
      for (let i = 0; i < words.length - 1; i++) {
        const gapA = words[i][1], gapB = words[i + 1][0];
        if (gapB - gapA > 1.0) {
          segs.push({ ...sg, id: uid(), start: from, end: gapA + pad });
          cut += (gapB - pad) - (gapA + pad);
          n += 1;
          from = gapB - pad;
        }
      }
      segs.push({ ...sg, id: uid(), start: from, end: sg.end });
    }
    if (!n) return say(L("Длинных пауз не нашёл", "No long pauses found", "Ұзақ үзіліс жоқ"));
    update({ segs });
    say(L(`Убрал паузы: ${n}, ролик короче на ${cut.toFixed(1)} сек`, `Removed ${n} pauses, ${cut.toFixed(1)} s shorter`));
  }
  /** Подбирает стиль субтитров под тип момента: крик и шум — ярче, разговор — спокойнее. */
  function aiCaptions() {
    const kind = proj.segs[0].clip.kind;
    const id = kind === "audio" ? "fire" : kind === "chat" || kind === "viewers" ? "hype" : proj.layout === "podcast" ? "podcast" : "classic";
    const pr = CAPTION_PRESETS().find((x) => x.id === id)!;
    update({ subtitles: true, aspect: proj.aspect === "16:9" ? "9:16" : proj.aspect, style: { ...proj.style, ...pr.style, caption_preset: id } });
    say(L(`Субтитры включены, стиль «${pr.name}»`, `Captions on, style “${pr.name}”`));
  }

  async function addLayers(from: "gallery" | "files") {
    setBusy("layers");
    try {
      let assets: { uri: string; name: string; type: string; w?: number; h?: number }[] = [];
      if (from === "gallery") {
        // iOS спросит: дать доступ ко всем фото или только к выбранным
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted && Platform.OS !== "web") {
          Alert.alert(L("Нет доступа к фото", "No access to photos"), L("Разреши доступ в настройках телефона.", "Allow access in phone settings."));
          return;
        }
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: 10, quality: 1 });
        if (r.canceled) return;
        assets = r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? "media", type: a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/png"), w: a.width, h: a.height }));
      } else {
        const r = await DocumentPicker.getDocumentAsync({ type: ["image/*", "video/*"], multiple: true, copyToCacheDirectory: true });
        if (r.canceled) return;
        assets = r.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? "" }));
      }
      const added: Layer[] = [];
      for (const a of assets) {
        const kind: Layer["kind"] = a.type.startsWith("video") ? "video" : a.type.includes("gif") || /\.gif$/i.test(a.name) ? "gif" : "image";
        const ratio = a.w && a.h ? a.w / a.h : kind === "video" ? 16 / 9 : 1;
        const up = await api.upload(kind === "video" ? "video" : "image", a.uri).catch(() => null);
        added.push({ id: uid(), kind, uri: a.uri, upload: up?.id ?? null, name: a.name, x: 0.5, y: 0.35 + added.length * 0.08,
                     scale: 0.4, ratio, from: 0, to: total });
      }
      update({ layers: [...proj.layers, ...added] });
      if (added.length) setSel({ kind: "layer", id: added[added.length - 1].id });
    } catch (e: any) {
      Alert.alert(L("Файл не загрузился", "Upload failed"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function addAudio() {
    setBusy("audio");
    try {
      // берём и музыку, и звук из видео: на некоторых телефонах трек лежит как видеофайл
      const r = await DocumentPicker.getDocumentAsync({ type: ["audio/*", "video/*", "application/ogg"], multiple: true, copyToCacheDirectory: true });
      if (r.canceled) return;
      const added: AudioTrack[] = [];
      for (const a of r.assets) {
        const up = await api.upload("audio", a.uri).catch(() => null);
        added.push({ id: uid(), name: a.name.replace(/\.[^.]+$/, ""), uri: a.uri, upload: up?.id ?? null, volume: 0.5 });
      }
      update({ audios: [...proj.audios, ...added] });
    } catch (e: any) {
      Alert.alert(L("Аудио не загрузилось", "Audio upload failed"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function addFont() {
    setBusy("font");
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ["font/ttf", "font/otf", "application/x-font-ttf", "application/x-font-otf",
                                                               "application/font-sfnt", "application/octet-stream"], copyToCacheDirectory: true });
      if (r.canceled) return;
      const a = r.assets[0];
      if (!/\.(ttf|otf)$/i.test(a.name)) return Alert.alert(L("Нужен файл шрифта .ttf или .otf", "Pick a .ttf or .otf font file"));
      const f: CustomFont = { id: uid(), name: a.name.replace(/\.(ttf|otf)$/i, ""), uri: a.uri };
      await Font.loadAsync({ [`custom_${f.id}`]: f.uri });
      const up = await api.upload("font", a.uri).catch(() => null);
      f.upload = up?.id ?? null;
      update({ fonts: [...proj.fonts, f], style: { ...proj.style, font: f.id } });
    } catch (e: any) {
      Alert.alert(L("Шрифт не загрузился", "Font failed to load"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function exportNow() {
    pause();
    if (total > maxLen + 0.05) {
      return say(L(`На твоём тарифе ролик до ${maxLen} сек, сейчас ${total.toFixed(1)}. Обрежь лишнее.`, `Your plan allows up to ${maxLen} s, now ${total.toFixed(1)}. Trim it.`));
    }
    setBusy("export");
    const st = proj.style;
    const extra = {
      quality: Math.min(proj.quality, maxQ), fps: proj.fps, aspect: proj.aspect, clip_volume: proj.clipVolume, denoise: proj.denoise,
      zoom: proj.zoom, pan_x: proj.panX, pan_y: proj.panY, rotate: proj.rotate, fit: proj.fit, keys: proj.keys, crop: proj.crop,
      layout: proj.layout, regions: proj.regions,
      texts: proj.texts, layers: proj.layers.map(({ uri, ...l }) => l), audios: proj.audios.map(({ uri, ...a }) => a),
      fonts: proj.fonts.map(({ uri, ...f }) => f),
    };
    try {
      let video: string;
      if (proj.segs.length === 1) {
        const sg = proj.segs[0];
        const words = proj.captions?.[sg.clip.id] ? toWords(proj.captions[sg.clip.id]) : null;
        video = (await api.edit(sg.clip.id, { start: sg.start, end: sg.end, speed: sp(sg), vertical: proj.aspect === "9:16", subtitles: proj.subtitles,
                                              title: proj.title, ...st, ...extra, words } as any)).video;
      } else {
        video = (await api.highlights(proj.segs.map((sg) => ({ clip: sg.clip.id, start: sg.start, end: sg.end, speed: sp(sg) })) as any, proj.aspect === "9:16",
                                      proj.subtitles, proj.title, { ...st, ...extra } as any)).video;
      }
      const next = { ...proj, exports: [{ video, at: Date.now() / 1000, quality: extra.quality, aspect: proj.aspect }, ...proj.exports].slice(0, 5) };
      setProj(next);
      projects.save(next);
      setTool(null);
      setDone(video);
    } catch (e: any) {
      Alert.alert(L("Не получилось смонтировать", "Render failed"), String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  // --- панели инструментов ---
  const selText = sel?.kind === "text" ? proj.texts.find((t) => t.id === sel.id) : undefined;
  const selLayer = sel?.kind === "layer" ? proj.layers.find((t) => t.id === sel.id) : undefined;
  const selSeg = sel?.kind === "seg" ? proj.segs.find((t) => t.id === sel.id) : undefined;
  const target = selSeg ?? here.sg; // кусок, к которому применяются скорость и прочее

  function selectFromPreview(x: Sel) {
    setSel(x);
    if (x?.kind === "text") setTool("text");
    if (x?.kind === "layer") setTool("layers");
  }
  function selectFromTimeline(x: Sel) {
    setSel(x);
    if (x?.kind === "seg") setTool("video");
    if (x?.kind === "text") setTool("text");
    if (x?.kind === "layer") setTool("layers");
  }

  const timing = (from: number, to: number, set: (from: number, to: number) => void) => (
    <Chips items={[{ id: "all", title: L("Весь ролик", "Whole video", "Бүкіл ролик") }, { id: "here", title: L("С курсора 3 сек", "3 s from cursor", "Курсордан 3 сек") },
                   { id: "rest", title: L("С курсора до конца", "Cursor to end", "Курсордан соңына дейін") }]}
           value={from <= 0.01 && to >= total - 0.01 ? "all" : to >= total - 0.01 ? "rest" : "here"}
           onChange={(v) => (v === "all" ? set(0, total) : v === "rest" ? set(pos, total) : set(pos, Math.min(total, pos + 3)))} />
  );
  const sw = (label: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={[s.row, { minHeight: 40 }]}>
      <P style={{ fontSize: 14, flex: 1 }}>{label}</P>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.raised }} />
    </View>
  );
  const head = (text: string) => <P dim style={{ fontSize: 12, fontWeight: "700", marginTop: 4 }}>{text.toUpperCase()}</P>;

  const panel = (() => {
    switch (tool) {
      case "video":
        return (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <IconBtn icon="cut" label={L("Разделить", "Split", "Бөлу")} onPress={split} />
              <IconBtn icon="trash-outline" label={L("Удалить", "Delete", "Өшіру")} off={!selSeg} onPress={() => selSeg && removeSeg(selSeg.id)} />
              <IconBtn icon="copy-outline" label={L("Дубль", "Duplicate", "Көшірме")} onPress={() => dupSeg(target.id)} />
              <IconBtn icon="arrow-back" label={L("Левее", "Earlier", "Солға")} off={!selSeg || proj.segs[0].id === selSeg.id} onPress={() => selSeg && moveSeg(selSeg.id, -1)} />
              <IconBtn icon="arrow-forward" label={L("Правее", "Later", "Оңға")} off={!selSeg || proj.segs[proj.segs.length - 1].id === selSeg.id} onPress={() => selSeg && moveSeg(selSeg.id, 1)} />
            </View>
            {selSeg && mergeable(selSeg.id) && (
              <Button kind="outline" icon="git-merge-outline" title={L("Склеить со следующим", "Merge with next", "Келесімен біріктіру")} onPress={() => mergeNext(selSeg.id)} />
            )}
            <Button kind="outline" icon="add" title={L("Добавить момент из клипов", "Add a moment from clips", "Клиптерден сәт қосу")} onPress={() => setPicking(true)} />
            <P dim style={{ fontSize: 12 }}>
              {L(`Нажми на кусок на ленте, чтобы выбрать его: тяни белые края, двигай, удаляй. Всего ${total.toFixed(1)} из ${maxLen} сек.`,
                 `Tap a piece on the timeline to select it: drag the white edges, move or delete it. Total ${total.toFixed(1)} of ${maxLen} s.`,
                 `Кесіндіні таңдау үшін таспада бас. Барлығы ${total.toFixed(1)} / ${maxLen} сек.`)}
            </P>

            {head(L("Скорость куска", "Piece speed", "Кесінді жылдамдығы"))}
            <View style={{ flexDirection: "row", gap: 6 }}>
              {SPEEDS.map((v) => (
                <Pressable key={v} onPress={() => setSpeed(target.id, v)}
                           style={{ flex: 1, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: sp(target) === v ? c.fg : c.raised }}>
                  <Text style={withFont({ color: sp(target) === v ? c.bg : c.fg, fontWeight: "700", fontSize: 13 })}>{v}x</Text>
                </Pressable>
              ))}
            </View>

            {head(L("Обрезать края видео", "Crop video edges", "Видео шеттерін кесу"))}
            <View style={{ flexDirection: "row", gap: 6 }}>
              <IconBtn icon="crop" label={cropping ? L("Готово", "Done", "Дайын") : L("Обрезать", "Crop", "Кесу")} on={cropping}
                       onPress={() => { if (proj.layout !== "full") update({ layout: "full" }); setCropping((x) => !x); }} />
              <IconBtn icon="refresh-outline" label={L("Без обрезки", "No crop", "Кесусіз")} off={!(proj.crop.l || proj.crop.t || proj.crop.r || proj.crop.b)}
                       onPress={() => update({ crop: { l: 0, t: 0, r: 0, b: 0 } })} />
            </View>
            {cropping && (
              <P dim style={{ fontSize: 12 }}>
                {L(`Тяни белые полоски на видео: сверху, снизу, слева, справа. Формат ${proj.aspect} остаётся. Срезано: сверху ${Math.round(proj.crop.t * 100)}%, снизу ${Math.round(proj.crop.b * 100)}%, слева ${Math.round(proj.crop.l * 100)}%, справа ${Math.round(proj.crop.r * 100)}%.`,
                   `Drag the white bars on the video: top, bottom, left, right. The ${proj.aspect} format stays.`,
                   `Видеодағы ақ жолақтарды тарт. ${proj.aspect} форматы өзгермейді.`)}
              </P>
            )}

            {head(L("Кадр", "Frame", "Кадр"))}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: c.raised, borderRadius: 10, padding: 10 }}>
              <Icon name="hand-left-outline" size={18} color={c.accent} />
              <P style={{ flex: 1, fontSize: 12 }}>
                {L("Двигай видео пальцем. Двумя пальцами — размер и поворот. Или тяни зелёную ручку в углу.",
                   "Drag the video with a finger. Two fingers resize and rotate. Or drag the green knob in the corner.",
                   "Видеоны саусақпен жылжыт. Екі саусақ — өлшем мен бұру. Немесе бұрыштағы жасыл тұтқаны тарт.")}
              </P>
            </View>
            <Chips items={[{ id: "fill", title: L("Заполнить", "Fill", "Толтыру") }, { id: "fit", title: L("Вписать целиком", "Fit whole", "Толық сыйғызу") }]}
                   value={proj.fit} onChange={(fit) => update({ fit: fit as Project["fit"], layout: "full" })} />
            <Row label={L("Масштаб", "Zoom", "Масштаб")}>
              <Stepper value={tf.zoom} min={0.3} max={4} step={0.1} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(z) => setTransform({ zoom: z })} />
            </Row>
            <Row label={L("Поворот", "Rotate", "Бұру")}>
              <Stepper value={proj.rotate} min={-180} max={180} step={5} fmt={(v) => `${Math.round(v)}°`} onChange={(rotate) => update({ rotate, layout: "full" })} />
            </Row>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <IconBtn icon="refresh-outline" label="−90°" onPress={() => update({ rotate: ((proj.rotate - 90 + 540) % 360) - 180, layout: "full" })} />
              <IconBtn icon="refresh-outline" label="+90°" onPress={() => update({ rotate: ((proj.rotate + 90 + 540) % 360) - 180, layout: "full" })} />
              <IconBtn icon="scan-outline" label={L("Сбросить", "Reset", "Қалпына")} onPress={() => update({ zoom: 1, panX: 0, panY: 0, rotate: 0, keys: [] })} />
            </View>

            {head(L("Ключевые кадры", "Keyframes", "Негізгі кадрлар"))}
            <View style={{ flexDirection: "row", gap: 6 }}>
              <IconBtn icon={keyHere ? "remove-circle-outline" : "add-circle-outline"} label={keyHere ? L("Убрать кадр", "Remove key") : L("Кадр здесь", "Key here")} on={!!keyHere}
                       onPress={() => keyHere ? update({ keys: proj.keys.filter((k) => k.id !== keyHere.id) })
                                              : update({ keys: [...proj.keys, { id: uid(), t: pos, ...tf }].sort((a, b) => a.t - b.t) })} />
              <IconBtn icon="trash-outline" label={L("Все убрать", "Clear all")} off={!proj.keys.length} onPress={() => update({ keys: [] })} />
            </View>
            <P dim style={{ fontSize: 12 }}>
              {L(`Кадров: ${proj.keys.length}. Поставь кадр, сдвинь курсор, увеличь видео — и камера плавно приблизится между кадрами.`,
                 `Keys: ${proj.keys.length}. Add a key, move the cursor, zoom the video, and the camera moves smoothly between keys.`,
                 `Кадрлар: ${proj.keys.length}. Кадр қой, курсорды жылжыт, видеоны үлкейт — камера кадрлар арасында бірқалыпты жақындайды.`)}
            </P>
          </View>
        );
      case "text":
        return (
          <View style={{ gap: 12 }}>
            {selText ? (
              <>
                <TextInput style={s.input} value={selText.text} onChangeText={(text) => editText(selText.id, { text })} maxLength={120}
                           placeholder={L("Напиши текст", "Type text", "Мәтін жаз")} placeholderTextColor={c.dim} />
                <ColorRow label={L("Цвет", "Color", "Түсі")} value={selText.color} fallback="#FFFFFF" onPick={(color) => editText(selText.id, { color })} />
                <Row label={L("Размер", "Size", "Өлшемі")}>
                  <Stepper value={selText.size} min={0.5} max={3} step={0.25} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(size) => editText(selText.id, { size })} />
                </Row>
                {sw(L("Обводка", "Outline", "Жиек"), !!selText.stroke, (stroke) => editText(selText.id, { stroke }))}
                {sw(L("Тень", "Shadow", "Көлеңке"), selText.shadow !== false, (shadow) => editText(selText.id, { shadow }))}
                <Chips items={ANIMS()} value={selText.anim ?? "none"} onChange={(anim) => editText(selText.id, { anim: anim as Anim })} />
                {proj.fonts.length > 0 && (
                  <Chips items={[{ id: "app", title: L("Наш шрифт", "Our font") }, ...proj.fonts.map((f) => ({ id: f.id, title: f.name }))]}
                         value={selText.font ?? "app"} onChange={(v) => editText(selText.id, { font: v === "app" ? null : v })} />
                )}
                {timing(selText.from, selText.to, (from, to) => editText(selText.id, { from, to }))}
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <IconBtn icon="add" label={L("Ещё текст", "More text", "Тағы мәтін")} onPress={addText} />
                  <IconBtn icon="copy-outline" label={L("Дубль", "Duplicate", "Көшірме")} onPress={() => {
                    const copy = { ...selText, id: uid(), y: clamp(selText.y + 0.1, 0.05, 0.95) };
                    update({ texts: [...proj.texts, copy] });
                    setSel({ kind: "text", id: copy.id });
                  }} />
                  <IconBtn icon="trash-outline" label={L("Удалить", "Delete", "Өшіру")}
                           onPress={() => { update({ texts: proj.texts.filter((t) => t.id !== selText.id) }); setSel(null); }} />
                </View>
                <P dim style={{ fontSize: 12 }}>{L("Двигай текст пальцем прямо на видео.", "Drag the text right on the video.", "Мәтінді видеода саусақпен жылжыт.")}</P>
              </>
            ) : (
              <>
                <Button icon="add" title={L("Добавить текст", "Add text", "Мәтін қосу")} onPress={addText} />
                {proj.texts.map((t) => (
                  <Pressable key={t.id} onPress={() => setSel({ kind: "text", id: t.id })} style={[s.row, { backgroundColor: c.raised, borderRadius: 10, paddingHorizontal: 12, height: 42 }]}>
                    <P numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{t.text}</P>
                    <Icon name="chevron-forward" size={18} color={c.dim} />
                  </Pressable>
                ))}
              </>
            )}
          </View>
        );
      case "captions": {
        const st = proj.style;
        return (
          <View style={{ gap: 10 }}>
            {sw(L("Субтитры по словам", "Word-by-word captions", "Сөзбе-сөз субтитр"), proj.subtitles, (subtitles) => update({ subtitles }))}
            {head(L("Готовые стили", "Ready styles", "Дайын стильдер"))}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {CAPTION_PRESETS().map((pr) => {
                const on = st.caption_preset === pr.id;
                return (
                  <Pressable key={pr.id} onPress={() => update({ subtitles: true, style: { ...st, ...pr.style, caption_preset: pr.id } })}
                             style={{ width: 96, height: 72, borderRadius: 10, backgroundColor: "#202024", alignItems: "center", justifyContent: "center", gap: 4,
                                      borderWidth: 2, borderColor: on ? c.accent : "transparent" }}>
                    <Text style={{ fontFamily: FONT.headingBlack, fontSize: 13, ...textFx(pr.style.stroke, pr.style.shadow) }}>
                      <Text style={{ color: pr.style.text_color! }}>{pr.style.upper ? "ВОТ " : "вот "}</Text>
                      <Text style={{ color: pr.style.word_color! }}>{pr.style.upper ? "ЭТО" : "это"}</Text>
                    </Text>
                    <Text style={withFont({ color: "#bbb", fontSize: 10 })}>{pr.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {sw(L("Обводка", "Outline", "Жиек"), !!st.stroke, (stroke) => setStyle({ ...st, stroke }))}
            {sw(L("Заглавные буквы", "Uppercase", "Бас әріптер"), st.upper !== false, (upper) => setStyle({ ...st, upper }))}
            <Chips items={ANIMS()} value={st.anim ?? "none"} onChange={(anim) => setStyle({ ...st, anim: anim as Anim })} />
            {head(L("Исправить текст", "Fix the text", "Мәтінді түзету"))}
            {proj.subtitles && (captions.length ? lay.map(({ sg, at }) => {
              const list = chunksOf(sg.clip);
              return list.map((ch, i) => (ch.end > sg.start && ch.start < sg.end) ? (
                <View key={`${sg.id}${i}`} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Pressable onPress={() => seek(at + Math.max(ch.start - sg.start, 0) / sp(sg))} style={{ width: 44 }}>
                    <P dim style={{ fontSize: 12 }}>{clockMs(at + Math.max(ch.start - sg.start, 0) / sp(sg))}</P>
                  </Pressable>
                  <TextInput style={[s.input, { flex: 1, minWidth: 0, height: 40 }]} value={ch.text} maxLength={60}
                             onChangeText={(text) => update({ captions: { ...(proj.captions ?? {}), [sg.clip.id]: list.map((x, j) => (j === i ? { ...x, text } : x)) } })} />
                </View>
              ) : null);
            }) : <P dim style={{ fontSize: 13 }}>{L("В этом куске стример ничего не говорит.", "Nothing is said in this part.")}</P>)}
          </View>
        );
      }
      case "layers":
        return (
          <View style={{ gap: 12 }}>
            {selLayer ? (
              <>
                <View style={[s.row, { gap: 8 }]}>
                  <Icon name={selLayer.kind === "video" ? "film" : "image"} size={18} color={c.accent} />
                  <P numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{selLayer.name}</P>
                </View>
                <Row label={L("Размер", "Size", "Өлшемі")}>
                  <Stepper value={selLayer.scale} min={0.1} max={1} step={0.1} onChange={(scale) => editLayer(selLayer.id, { scale })} />
                </Row>
                <Row label={L("Прозрачность", "Opacity", "Мөлдірлік")}>
                  <Stepper value={selLayer.opacity ?? 1} min={0.1} max={1} step={0.1} onChange={(opacity) => editLayer(selLayer.id, { opacity })} />
                </Row>
                <Row label={L("Скругление углов", "Rounded corners", "Бұрыштарды дөңгелету")}>
                  <Stepper value={selLayer.radius ?? 0} min={0} max={0.5} step={0.1} fmt={(v) => `${Math.round(v * 200)}%`} onChange={(radius) => editLayer(selLayer.id, { radius })} />
                </Row>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  <IconBtn icon="arrow-up" label={L("Выше", "Forward", "Жоғары")} off={proj.layers[proj.layers.length - 1].id === selLayer.id} onPress={() => moveLayer(selLayer.id, 1)} />
                  <IconBtn icon="arrow-down" label={L("Ниже", "Backward", "Төмен")} off={proj.layers[0].id === selLayer.id} onPress={() => moveLayer(selLayer.id, -1)} />
                  <IconBtn icon={selLayer.hidden ? "eye-off-outline" : "eye-outline"} label={selLayer.hidden ? L("Показать", "Show") : L("Скрыть", "Hide")} on={selLayer.hidden}
                           onPress={() => editLayer(selLayer.id, { hidden: !selLayer.hidden })} />
                  <IconBtn icon={selLayer.locked ? "lock-closed" : "lock-open-outline"} label={selLayer.locked ? L("Открыть", "Unlock") : L("Замок", "Lock")} on={selLayer.locked}
                           onPress={() => editLayer(selLayer.id, { locked: !selLayer.locked })} />
                  <IconBtn icon="copy-outline" label={L("Дубль", "Duplicate", "Көшірме")} onPress={() => dupLayer(selLayer.id)} />
                </View>
                {timing(selLayer.from, selLayer.to, (from, to) => editLayer(selLayer.id, { from, to }))}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button style={{ flex: 1 }} kind="outline" icon="arrow-back" title={L("Все слои", "All layers", "Барлық қабат")} onPress={() => setSel(null)} />
                  <Button style={{ flex: 1 }} kind="outline" icon="trash-outline" title={L("Удалить", "Delete", "Өшіру")}
                          onPress={() => { update({ layers: proj.layers.filter((t) => t.id !== selLayer.id) }); setSel(null); }} />
                </View>
              </>
            ) : (
              <>
                <P dim style={{ fontSize: 12 }}>
                  {L("Фото, PNG с прозрачным фоном, скрины, логотипы, гифки и видео. Можно выбрать несколько сразу. Верхний в списке — поверх всех.",
                     "Photos, transparent PNGs, screenshots, logos, GIFs and videos. Pick several at once. Top of the list is in front.",
                     "Фото, мөлдір PNG, скрин, логотип, GIF және видео. Бірнешеуін бірден таңдауға болады.")}
                </P>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button style={{ flex: 1 }} icon="images-outline" title={L("Из галереи", "From gallery", "Галереядан")} busy={busy === "layers"} onPress={() => addLayers("gallery")} />
                  <Button style={{ flex: 1 }} kind="outline" icon="folder-open-outline" title={L("Из файлов", "From files", "Файлдардан")} onPress={() => addLayers("files")} />
                </View>
                {[...proj.layers].reverse().map((l) => (
                  <Pressable key={l.id} onPress={() => setSel({ kind: "layer", id: l.id })} style={[s.row, { backgroundColor: c.raised, borderRadius: 10, paddingHorizontal: 12, height: 42, gap: 8 }]}>
                    <Icon name={l.kind === "video" ? "film" : "image"} size={16} color={c.dim} />
                    <P numberOfLines={1} style={{ flex: 1, fontSize: 14, opacity: l.hidden ? 0.5 : 1 }}>{l.name}</P>
                    <Pressable hitSlop={8} onPress={() => editLayer(l.id, { hidden: !l.hidden })}><Icon name={l.hidden ? "eye-off-outline" : "eye-outline"} size={18} color={c.dim} /></Pressable>
                    <Pressable hitSlop={8} onPress={() => editLayer(l.id, { locked: !l.locked })}><Icon name={l.locked ? "lock-closed" : "lock-open-outline"} size={18} color={c.dim} /></Pressable>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        );
      case "audio":
        return (
          <View style={{ gap: 10 }}>
            <Row label={L("Звук клипа", "Clip sound", "Клип дыбысы")}>
              <Stepper value={proj.clipVolume} onChange={(clipVolume) => update({ clipVolume })} />
            </Row>
            {sw(L("Убрать шум из голоса", "Remove noise from voice", "Дауыстағы шуды алу"), proj.denoise, (denoise) => update({ denoise }))}
            {proj.audios.map((a) => (
              <View key={a.id} style={{ backgroundColor: c.raised, borderRadius: 10, padding: 10, gap: 6 }}>
                <View style={s.row}>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flex: 1 }}>
                    <Icon name="musical-notes" size={16} color={c.accent} />
                    <P numberOfLines={1} style={{ fontSize: 14, flex: 1 }}>{a.name}</P>
                  </View>
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <Pressable hitSlop={8} onPress={() => editAudio(a.id, { muted: !a.muted })}>
                      <Icon name={a.muted ? "volume-mute" : "volume-high-outline"} size={19} color={a.muted ? c.danger : c.dim} />
                    </Pressable>
                    <Pressable hitSlop={8} onPress={() => update({ audios: proj.audios.filter((x) => x.id !== a.id) })}>
                      <Icon name="trash-outline" size={18} color={c.dim} />
                    </Pressable>
                  </View>
                </View>
                <Row label={L("Громкость", "Volume", "Дыбыс")}>
                  <Stepper value={a.volume} onChange={(volume) => editAudio(a.id, { volume })} />
                </Row>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <IconBtn icon="trending-up-outline" label={L("Плавно в начале", "Fade in", "Біртіндеп басы")} on={a.fadeIn} onPress={() => editAudio(a.id, { fadeIn: !a.fadeIn })} />
                  <IconBtn icon="trending-down-outline" label={L("Плавно в конце", "Fade out", "Біртіндеп соңы")} on={a.fadeOut} onPress={() => editAudio(a.id, { fadeOut: !a.fadeOut })} />
                </View>
              </View>
            ))}
            <Button icon="add" busy={busy === "audio"} title={L("Добавить музыку или звук", "Add music or sound", "Музыка не дыбыс қосу")} onPress={addAudio} />
            <P dim style={{ fontSize: 11 }}>
              {L("Можно несколько треков: музыка, мемные звуки, эффекты. Подходят mp3, m4a, wav, ogg и звук из видео. Используй только то, на что у тебя есть права.",
                 "Several tracks are fine: music, meme sounds, effects. mp3, m4a, wav, ogg and sound from videos work. Use only what you have the rights to.")}
            </P>
          </View>
        );
      case "ai":
        return (
          <View style={{ gap: 10 }}>
            {([
              ["scan-circle-outline", L("Авто-зум к моменту", "Auto zoom to the moment", "Сәтке авто-зум"),
               L("Камера плавно приближается к самому яркому моменту и отдаляется", "The camera smoothly zooms into the biggest moment and back"), autoZoom],
              ["cut-outline", L("Убрать паузы", "Remove pauses", "Үзілістерді алу"),
               L("Вырезает места, где стример молчит дольше секунды", "Cuts places where the streamer is silent for over a second"), removeSilence],
              ["chatbox-ellipses-outline", L("Подобрать субтитры", "Style captions", "Субтитр таңдау"),
               L("Включает субтитры и подбирает стиль под тип момента", "Turns on captions and picks a style for the moment"), aiCaptions],
              ["grid-outline", L("Вебка сверху, игра снизу", "Cam on top, game below", "Камера жоғарыда"),
               L("Ставит шаблон Gaming. Вебку можно подвинуть пальцем", "Applies the Gaming template. Drag the cam to adjust"), () => applyLayout("gaming")],
            ] as [IconName, string, string, () => void][]).map(([icon, name, hint, f]) => (
              <Pressable key={name} onPress={f} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.raised, borderRadius: 12, padding: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                  <Icon name={icon} size={20} color={c.onAccent} />
                </View>
                <View style={{ flex: 1 }}>
                  <P style={{ fontWeight: "700", fontSize: 14 }}>{name}</P>
                  <P dim style={{ fontSize: 12 }}>{hint}</P>
                </View>
              </Pressable>
            ))}
            <P dim style={{ fontSize: 11 }}>{L("Любое действие можно отменить стрелкой сверху.", "Any action can be undone with the arrow at the top.", "Кез келген әрекетті жоғарыдағы көрсеткімен болдырмауға болады.")}</P>
          </View>
        );
      case "templates":
        return (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {LAYOUTS().map((l) => {
                const on = proj.aspect === "9:16" && proj.layout === l.id;
                return (
                  <Pressable key={l.id} onPress={() => applyLayout(l.id)}
                             style={{ width: "31%", flexGrow: 1, backgroundColor: c.raised, borderRadius: 12, padding: 8, gap: 6, alignItems: "center",
                                      borderWidth: 2, borderColor: on ? c.accent : "transparent" }}>
                    <View style={{ width: 34, height: 60, borderRadius: 4, overflow: "hidden", borderWidth: 1.5, borderColor: on ? c.accent : c.dim }}>
                      {l.band ? <View style={{ height: 60 * l.band, backgroundColor: "#fff" }} /> : null}
                      {(l.areas.length ? l.areas : [{ region: "game" as Region, h: 1 }]).map((a, i) => (
                        <View key={i} style={{ height: (60 - 3) * a.h, backgroundColor: a.region === "cam" ? "#8E5CF6" : a.region === "chat" ? "#2F7BE0" : "#2E7D5B",
                                               borderTopWidth: i ? 1 : 0, borderColor: "#000" }} />
                      ))}
                    </View>
                    <P style={{ fontWeight: "700", fontSize: 12 }}>{l.name}</P>
                    <P dim numberOfLines={2} style={{ fontSize: 9, textAlign: "center" }}>{l.hint}</P>
                  </Pressable>
                );
              })}
            </View>
            {proj.layout !== "full" && proj.aspect === "9:16" && (
              <>
                <P dim style={{ fontSize: 12 }}>
                  {L("Двигай вебку, игру и чат пальцем прямо в их окнах, двумя пальцами меняй размер.", "Drag the cam, game and chat right in their windows; pinch to resize.",
                     "Камераны, ойынды және чатты терезелерінде саусақпен жылжыт.")}
                </P>
                {head(L("Где вебка на стриме", "Where the cam is on stream", "Стримде камера қайда"))}
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {([["tl", L("Слева сверху", "Top left")], ["tr", L("Справа сверху", "Top right")], ["bl", L("Слева снизу", "Bottom left")], ["br", L("Справа снизу", "Bottom right")]] as const).map(([k, name]) => (
                    <IconBtn key={k} icon="videocam-outline" label={name} onPress={() => camCorner(k)} />
                  ))}
                </View>
                <Button kind="outline" icon="refresh-outline" title={L("Вернуть как было", "Reset windows", "Қалпына келтіру")}
                        onPress={() => update({ regions: { ...REGIONS(), ...(proj.segs[0].clip.cam ? { cam: proj.segs[0].clip.cam } : null) } })} />
              </>
            )}
            {head(L("Мои шаблоны", "My templates", "Менің үлгілерім"))}
            {myPresets.map((pr) => (
              <View key={pr.id} style={[s.row, { backgroundColor: c.raised, borderRadius: 10, paddingHorizontal: 12, height: 44, gap: 8 }]}>
                <Icon name="bookmark" size={16} color={c.accent} />
                <P numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{pr.name}</P>
                <Pressable onPress={() => { update({ aspect: pr.aspect, layout: pr.layout, regions: pr.regions, style: { ...proj.style, ...pr.style }, subtitles: pr.subtitles }); say(L("Шаблон применён", "Template applied")); }}>
                  <P style={{ color: c.accent, fontWeight: "700", fontSize: 13 }}>{L("Применить", "Apply", "Қолдану")}</P>
                </Pressable>
                <Pressable hitSlop={8} onPress={() => presets.remove(pr.id)}><Icon name="trash-outline" size={17} color={c.dim} /></Pressable>
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[s.input, { flex: 1, minWidth: 0, height: 44 }]} value={presetName} onChangeText={setPresetName} maxLength={40}
                         placeholder={L("Название шаблона", "Template name", "Үлгі атауы")} placeholderTextColor={c.dim} />
              <Button icon="bookmark-outline" title={L("Сохранить", "Save", "Сақтау")} style={{ height: 44 }} onPress={savePreset} />
            </View>
            <P dim style={{ fontSize: 11 }}>{L("Сохраняет формат, раскладку и стиль текста, чтобы оформлять следующие клипы в один тап.",
                                              "Saves the format, layout and text style so the next clips take one tap.")}</P>
          </View>
        );
      case "format":
        return (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {ASPECTS.map(({ id, r, hint }) => {
                const on = id === proj.aspect;
                const bw = r >= 1 ? 34 : 34 * r, bh = r >= 1 ? 34 / r : 34;
                return (
                  <Pressable key={id} style={{ width: "23%", flexGrow: 1, alignItems: "center", gap: 4, paddingVertical: 8, borderRadius: 12,
                                                backgroundColor: c.raised, borderWidth: 2, borderColor: on ? c.accent : "transparent" }}
                             onPress={() => {
                               if (id !== "16:9" && !canVertical) return say(L("Другие форматы есть на Creator и выше", "Other formats are on Creator and above"));
                               update({ aspect: id });
                             }}>
                    <View style={{ height: 36, justifyContent: "center" }}>
                      <View style={{ width: bw, height: bh, borderRadius: 3, borderWidth: 2, borderColor: on ? c.accent : c.dim }} />
                    </View>
                    <P style={{ fontWeight: "700", fontSize: 13 }}>{id}</P>
                    <P dim numberOfLines={1} style={{ fontSize: 9 }}>{hint()}</P>
                  </Pressable>
                );
              })}
            </View>
            <P dim style={{ fontSize: 12 }}>
              {L("Масштаб, поворот и ключевые кадры — во вкладке «Видео». Или разведи два пальца на самом видео.", "Zoom, rotation and keyframes are in Video. Or pinch the video itself.",
                 "Масштаб, бұру және кадрлар — «Видео» бөлімінде.")}
            </P>
          </View>
        );
      case "title":
        return (
          <View style={{ gap: 12 }}>
            <TextInput style={s.input} value={proj.title} onChangeText={(title) => update({ title })} maxLength={80}
                       placeholder={L("Заголовок в начале ролика", "Hook title at the start")} placeholderTextColor={c.dim} />
            <ColorRow label={L("Цвет заголовка", "Title color")} value={proj.style.title_color} fallback={DEFAULT_COLORS.title}
                      onPick={(col) => setStyle({ ...proj.style, title_color: col })} />
          </View>
        );
      case "font":
        return (
          <View style={{ gap: 12 }}>
            <Chips items={[...fontChoices(), ...proj.fonts.map((f) => ({ id: f.id, title: f.name }))]} value={proj.style.font ?? "classic"}
                   onChange={(font) => setStyle({ ...proj.style, font })} />
            <Button kind="outline" icon="document-outline" busy={busy === "font"}
                    title={L("Свой шрифт из файлов (.ttf, .otf)", "Your font from files (.ttf, .otf)", "Файлдан өз қаріпің (.ttf, .otf)")} onPress={addFont} />
            <ColorRow label={L("Цвет субтитров", "Caption color")} value={proj.style.text_color} fallback={DEFAULT_COLORS.text}
                      onPick={(col) => setStyle({ ...proj.style, text_color: col })} />
            <ColorRow label={L("Цвет слова, которое звучит", "Color of the spoken word")} value={proj.style.word_color} fallback={DEFAULT_COLORS.word}
                      onPick={(col) => setStyle({ ...proj.style, word_color: col })} />
          </View>
        );
      case "export":
        return (
          <View style={{ gap: 12 }}>
            <P dim style={{ fontSize: 12 }}>{L("Качество", "Quality", "Сапа")}</P>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {QUALITIES.map((q) => {
                const locked = q > maxQ;
                const on = q === Math.min(proj.quality, maxQ);
                return (
                  <Pressable key={q} onPress={() => locked
                    ? say(L(`${qName(q)} есть на тарифе ${q >= 1440 ? "Business" : "Creator"}. Сменить тариф можно в профиле.`, `${qName(q)} is on ${q >= 1440 ? "Business" : "Creator"}. Upgrade in your profile.`))
                    : update({ quality: q })}
                             style={{ flex: 1, height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 2,
                                      backgroundColor: on ? c.fg : c.raised, opacity: locked ? 0.45 : 1 }}>
                    <Text style={withFont({ color: on ? c.bg : c.fg, fontWeight: "700", fontSize: 15 })}>{qName(q)}</Text>
                    {locked && <Icon name="lock-closed" size={11} color={c.dim} />}
                  </Pressable>
                );
              })}
            </View>
            <P dim style={{ fontSize: 12 }}>{L("Кадров в секунду", "Frames per second", "Секундына кадр")}</P>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {([30, 60] as const).map((f) => (
                <Pressable key={f} onPress={() => update({ fps: f })}
                           style={{ flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: proj.fps === f ? c.fg : c.raised }}>
                  <Text style={withFont({ color: proj.fps === f ? c.bg : c.fg, fontWeight: "700", fontSize: 15 })}>{f} FPS</Text>
                </Pressable>
              ))}
            </View>
            <P dim style={{ fontSize: 12 }}>
              {proj.aspect} · {total.toFixed(1)} {L("сек", "s")} · {L("кусков", "pieces", "кесінді")}: {proj.segs.length} · {L("на тарифе до", "plan allows up to")} {qName(maxQ)}
            </P>
            <Button icon="arrow-up" busy={busy === "export"} title={L("Экспортировать", "Export", "Экспорттау")} onPress={exportNow} />
          </View>
        );
      default:
        return null;
    }
  })();

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: TOP, paddingHorizontal: 12, ...(Platform.OS === "web" ? { height: win.height } : null) }}>
        <View style={[s.row, { height: 44 }]}>
          <Pressable hitSlop={10} onPress={() => setDone(null)}><Icon name="chevron-back" size={26} /></Pressable>
          <P style={{ fontWeight: "700" }}>{L("Готово, проект сохранён", "Done, project saved", "Дайын, жоба сақталды")}</P>
          <Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={26} /></Pressable>
        </View>
        <Result video={done} onBack={() => setDone(null)}
                onTelegram={() => (proj.segs.length === 1 ? api.sendClip(proj.segs[0].clip.id) : api.sendHighlights("last"))} />
      </View>
    );
  }

  const panelTitle = tool === "export" ? L("Экспорт", "Export", "Экспорт") : tool ? tools().find(([id]) => id === tool)![1] : "";
  const canUndo = past.current.length > 0, canRedo = future.current.length > 0;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: TOP, ...(Platform.OS === "web" ? { height: win.height } : null) }}>
      {proj.audios.map((a) => <AudioPreview key={a.id} track={a} playing={playing} pos={pos} total={total} />)}
      <View style={[s.row, { height: 48, paddingHorizontal: 12 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Pressable hitSlop={10} onPress={() => { pause(); onClose(); }}><Icon name="close" size={26} /></Pressable>
          <Pressable testID="undo" hitSlop={8} onPress={undo} disabled={!canUndo}><Icon name="arrow-undo-outline" size={22} color={canUndo ? c.fg : c.line} /></Pressable>
          <Pressable testID="redo" hitSlop={8} onPress={redo} disabled={!canRedo}><Icon name="arrow-redo-outline" size={22} color={canRedo ? c.fg : c.line} /></Pressable>
        </View>
        <View style={{ backgroundColor: c.raised, borderRadius: 8, paddingHorizontal: 8, height: 28, justifyContent: "center", maxWidth: 110 }}>
          <P numberOfLines={1} style={{ fontSize: 11, fontWeight: "600" }}>{proj.aspect} · {total.toFixed(1)} {L("с", "s")}</P>
        </View>
        <Pressable onPress={() => pickTool("export")}
                   style={{ backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 12, height: 32, justifyContent: "center", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="arrow-up" size={15} color={c.onAccent} />
          <Text style={withFont({ color: c.onAccent, fontWeight: "700", fontSize: 14 })}>{L("Экспорт", "Export", "Экспорт")}</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1, maxHeight: tool ? undefined : Math.round(win.height * 0.5), paddingHorizontal: 12, paddingVertical: 6, minHeight: 150 }}>
        <Preview player={player} camPlayer={camPlayer} proj={proj} pos={pos} tf={tf} chunk={chunkNow} sample={sample} sel={sel} safe={safe} editing={tool === "video"} cropping={cropping && tool === "video"}
                 onSelect={selectFromPreview} onChange={update} onTransform={setTransform} />
        {note && (
          <View pointerEvents="none" style={{ position: "absolute", top: 10, left: 20, right: 20, alignItems: "center" }}>
            <View style={{ backgroundColor: "rgba(20,20,22,0.94)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.line }}>
              <P style={{ fontSize: 13, textAlign: "center" }}>{note}</P>
            </View>
          </View>
        )}
      </View>

      <View style={[s.row, { paddingHorizontal: 16, height: 38 }]}>
        <P style={{ fontSize: 12, width: 110 }}>{clockMs(pos)} <Text style={{ color: c.dim }}>/ {clockMs(total)}</Text></P>
        <Pressable hitSlop={10} onPress={toggle}><Icon name={playing ? "pause" : "play"} size={28} /></Pressable>
        <View style={{ width: 110, flexDirection: "row", justifyContent: "flex-end", gap: 14 }}>
          <Pressable testID="safe" hitSlop={8} onPress={() => setSafe((x) => !x)}><Icon name="phone-portrait-outline" size={21} color={safe ? c.accent : c.fg} /></Pressable>
          <Pressable hitSlop={8} onPress={() => setZoom(zoom / 1.6)}><Icon name="remove-circle-outline" size={22} color={zoom <= ZOOM_MIN ? c.line : c.fg} /></Pressable>
          <Pressable hitSlop={8} onPress={() => setZoom(zoom * 1.6)}><Icon name="add-circle-outline" size={22} color={zoom >= ZOOM_MAX ? c.line : c.fg} /></Pressable>
        </View>
      </View>

      <Timeline proj={proj} total={total} pos={pos} playing={playing} sel={sel} captions={captions} scrollRef={scrollRef}
                onGrab={pause} onScrub={(t) => seek(t, false)} onZoom={setZoom} onSelect={selectFromTimeline}
                onTrim={(id, start, end) => {
                  const sg = proj.segs.find((x) => x.id === id)!;
                  const others = proj.segs.filter((x) => x.id !== id).reduce((a, x) => a + segLen(x), 0);
                  if (others + (end - start) / sp(sg) > maxLen + 0.01) return; // не длиннее тарифа
                  update({ segs: proj.segs.map((x) => (x.id === id ? { ...x, start, end } : x)) });
                }} />
      {!tool && <View style={{ flexGrow: 0.2 }} />}

      {tool ? (
        <View style={{ backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: Platform.OS === "web" ? 10 : 26 }}>
          <View style={[s.row, { paddingHorizontal: 16, height: 44 }]}>
            <P style={{ fontWeight: "700" }}>{panelTitle}</P>
            <Pressable testID="panel-done" hitSlop={10} onPress={() => { setTool(null); setSel(null); setCropping(false); }}
                       style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
              <Icon name="checkmark" size={20} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: Math.round(win.height * 0.32) }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {panel}
          </ScrollView>
        </View>
      ) : (
        <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingBottom: Platform.OS === "web" ? 6 : 24 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 6 }}>
            {tools().map(([id, name, icon]) => {
              const off = proj.aspect === "16:9" && (id === "title" || id === "captions");
              return (
                <Pressable key={id} onPress={() => pickTool(id)} style={{ width: 66, height: 64, alignItems: "center", justifyContent: "center", gap: 5, opacity: off ? 0.4 : 1 }}>
                  <Icon name={icon} size={23} color={id === "ai" ? c.accent : c.fg} />
                  <Text numberOfLines={1} style={withFont({ color: c.fg, fontSize: 11, fontWeight: "500" })}>{name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <ClipPicker onPick={addMoment} onClose={() => setPicking(false)} />
      </Modal>
    </View>
  );
}
