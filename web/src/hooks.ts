import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Live } from "./data/live";
import type { Model } from "./data/model";

export const ModelContext = createContext<Model | null>(null);
export const LiveContext = createContext<Live>({ stats: null, readAt: null, snapshot: null });

export function useModel(): Model {
  const m = useContext(ModelContext);
  if (!m) throw new Error("no model");
  return m;
}

export const useLiveStats = () => useContext(LiveContext);

/** Page titles are short names. */
export function useTitle(name: string) {
  useEffect(() => {
    document.title = name;
  }, [name]);
}

/** The width of an element, kept current. Charts draw at real pixels so text stays the size it was set. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const watcher = new ResizeObserver(() => setWidth(el.clientWidth));
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);
  return [ref, width];
}

/** Re-renders on a timer, for "12 s ago" labels. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Finds the point closest to the pointer, so a reader never has to land on a small mark. */
export function nearest<P extends { x: number; y: number }>(points: P[], x: number, y: number, limit: number): P | null {
  let best: P | null = null;
  let bestD = limit * limit;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
