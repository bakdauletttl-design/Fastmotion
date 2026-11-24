// Проекты монтажа: всё, что человек сделал в редакторе, хранится на телефоне.
// Можно вернуться, поменять, добавить моменты и снова экспортировать.
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Clip, Style } from "./api";

export type Aspect = "9:16" | "16:9" | "1:1" | "4:5" | "3:4" | "4:3" | "5:4";
/** Кусок клипа на ленте. Куски идут друг за другом. */
export type Seg = { id: string; clip: Clip; start: number; end: number; speed?: number }; // speed: 0.5 — замедление, 2 — ускорение
/** Свой текст поверх видео. Время — по ленте проекта. x, y — центр в долях кадра. */
export type Anim = "none" | "pop" | "fade" | "slide";
export type TextLayer = {
  id: string; text: string; color: string; font?: string | null; size: number; x: number; y: number; from: number; to: number;
  stroke?: boolean; shadow?: boolean; anim?: Anim;
};
/** Фото, скрин, логотип, гифка или видео поверх клипа. scale — ширина в долях кадра. */
export type Layer = {
  id: string; kind: "image" | "gif" | "video"; uri: string; upload?: string | null; name: string;
  x: number; y: number; scale: number; ratio: number; from: number; to: number; // ratio = ширина / высота
  opacity?: number; radius?: number; hidden?: boolean; locked?: boolean; // порядок слоёв = порядок в списке, последний сверху
};
export type AudioTrack = { id: string; name: string; uri: string; upload?: string | null; volume: number; muted?: boolean; fadeIn?: boolean; fadeOut?: boolean };
export type CustomFont = { id: string; name: string; uri: string; upload?: string | null };
/** Часть исходного кадра в долях: x, y — левый верхний угол. */
export type Rect = { x: number; y: number; w: number; h: number };
/** Шаблон раскладки для вертикального ролика: где вебка, где игра, где чат. */
export type LayoutId = "full" | "gaming" | "facecam" | "chat" | "podcast" | "meme" | "split";
/** Ключевой кадр: в этот момент ленты видео имеет такой масштаб и сдвиг, между кадрами — плавно. */
export type Key = { id: string; t: number; zoom: number; panX: number; panY: number };
export type Export = { video: string; at: number; quality: number; aspect: Aspect };

export type Project = {
  id: string; name: string; created: number; updated: number;
  segs: Seg[]; aspect: Aspect; quality: number;
  title: string; subtitles: boolean; style: Style;
  texts: TextLayer[]; layers: Layer[]; audios: AudioTrack[]; fonts: CustomFont[];
  clipVolume: number; zoom: number; panX: number; panY: number; // звук клипа и масштаб видео в кадре
  rotate: number; fit: "fill" | "fit"; keys: Key[]; denoise: boolean; fps: 30 | 60;
  layout: LayoutId; regions: { cam: Rect; game: Rect; chat: Rect };
  crop: { l: number; t: number; r: number; b: number }; // сколько срезано с каждого края видео, в долях
  captions?: Record<string, { start: number; end: number; text: string }[]>; // исправленные субтитры по клипам
  exports: Export[];
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newProject(clips: { clip: Clip; start?: number; end?: number }[], maxLen: number, vertical: boolean): Project {
  const now = Date.now() / 1000;
  const first = clips[0].clip;
  return {
    id: uid(), name: first.title ?? first.channel, created: now, updated: now,
    segs: clips.map(({ clip, start, end }) => {
      const full = clip.source_duration ?? clip.duration;
      return { id: uid(), clip, start: start ?? 0, end: end ?? Math.min(full, maxLen) };
    }),
    aspect: vertical ? "9:16" : "16:9", quality: 720, title: first.title ?? "", subtitles: true,
    style: { font: "classic" }, texts: [], layers: [], audios: [], fonts: [],
    clipVolume: 1, zoom: 1, panX: 0, panY: 0, exports: [], ...DEFAULTS(),
    regions: { ...REGIONS(), ...(first.cam ? { cam: first.cam } : null) }, // вебку сервер уже нашёл — окно сразу на лице
  };
}

export const REGIONS = () => ({ cam: { x: 0, y: 0, w: 0.3, h: 0.36 }, game: { x: 0.12, y: 0, w: 0.76, h: 1 }, chat: { x: 0.72, y: 0.15, w: 0.28, h: 0.7 } });
const DEFAULTS = () => ({ crop: { l: 0, t: 0, r: 0, b: 0 }, rotate: 0, fit: "fill" as const, keys: [], denoise: false, fps: 30 as const, layout: "full" as const, regions: REGIONS() });
/** Старые проекты без новых полей открываются как раньше. */
export const fixProject = (p: Project): Project => ({
  ...DEFAULTS(), ...p, regions: { ...REGIONS(), ...(p.segs[0]?.clip.cam ? { cam: p.segs[0].clip.cam } : null), ...(p.regions ?? {}) },
});

/** Мой шаблон: оформление, которое можно применить к любому клипу. */
export type Preset = { id: string; name: string; aspect: Aspect; layout: LayoutId; regions: Project["regions"]; style: Style; subtitles: boolean };

// --- хранение ---
const KEY = "hypecut_projects";
let items: Project[] | null = null;
const listeners = new Set<() => void>();

function file() {
  return new File(Paths.document, "projects.json");
}

async function load(): Promise<Project[]> {
  if (items) return items;
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : (file().exists ? await file().text() : null);
    items = raw ? JSON.parse(raw) : [];
  } catch {
    items = [];
  }
  return items!;
}

function persist() {
  const raw = JSON.stringify(items ?? []);
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, raw);
    else file().write(raw);
  } catch {}
  listeners.forEach((f) => f());
}

export const projects = {
  async save(p: Project) {
    const all = await load();
    const next = { ...p, updated: Date.now() / 1000 };
    items = [next, ...all.filter((x) => x.id !== p.id)].slice(0, 50);
    persist();
  },
  async remove(id: string) {
    items = (await load()).filter((x) => x.id !== id);
    persist();
  },
};

// --- мои шаблоны ---
const PKEY = "hypecut_presets";
let presetItems: Preset[] | null = null;
const pfile = () => new File(Paths.document, "presets.json");
async function loadPresets(): Promise<Preset[]> {
  if (presetItems) return presetItems;
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(PKEY) : (pfile().exists ? await pfile().text() : null);
    presetItems = raw ? JSON.parse(raw) : [];
  } catch {
    presetItems = [];
  }
  return presetItems!;
}
function persistPresets() {
  const raw = JSON.stringify(presetItems ?? []);
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(PKEY, raw);
    else pfile().write(raw);
  } catch {}
  listeners.forEach((f) => f());
}
export const presets = {
  async save(x: Preset) { presetItems = [x, ...(await loadPresets()).filter((y) => y.id !== x.id)].slice(0, 30); persistPresets(); },
  async remove(id: string) { presetItems = (await loadPresets()).filter((y) => y.id !== id); persistPresets(); },
};
export function usePresets(): Preset[] {
  const [list, setList] = useState<Preset[]>(presetItems ?? []);
  useEffect(() => {
    const f = () => setList([...(presetItems ?? [])]);
    listeners.add(f);
    loadPresets().then(f);
    return () => void listeners.delete(f);
  }, []);
  return list;
}

export function useProjects(): Project[] {
  const [list, setList] = useState<Project[]>(items ?? []);
  useEffect(() => {
    const f = () => setList([...(items ?? [])]);
    listeners.add(f);
    load().then(f);
    return () => void listeners.delete(f);
  }, []);
  return list;
}
