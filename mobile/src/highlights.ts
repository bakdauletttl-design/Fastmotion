// Корзина хайлайтов: моменты, которые человек собирает в один ролик. Живёт, пока открыто приложение.
import { useEffect, useState } from "react";
import { Part } from "./api";

export type Moment = Part & { title: string; thumb: string | null };

let items: Moment[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const reel = {
  get: () => items,
  add(m: Moment) {
    items = [...items, m].slice(-12); // сервер склеивает до 12 моментов
    emit();
  },
  remove(i: number) {
    items = items.filter((_, j) => j !== i);
    emit();
  },
  move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    items = next;
    emit();
  },
  clear() {
    items = [];
    emit();
  },
};

export function useReel(): Moment[] {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return items;
}
