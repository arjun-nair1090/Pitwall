// Per-browser workspace layouts. Versioned, and validated against the current
// default panels so adding or removing a panel later cannot break saved layouts:
// a stale layout is discarded in favour of the defaults.

export interface PanelLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Layouts = Record<string, PanelLayout[]>;
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const VERSION = 1;
const keyFor = (workspace: string) => `pitwall.layout.v${VERSION}.${workspace}`;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked site data / private windows
  }
}

function validPanel(p: unknown): p is PanelLayout {
  if (typeof p !== "object" || p === null) return false;
  const q = p as Record<string, unknown>;
  const int = (v: unknown, min: number) => typeof v === "number" && Number.isFinite(v) && v >= min;
  return typeof q.i === "string" && int(q.x, 0) && int(q.y, 0) && int(q.w, 1) && int(q.h, 1);
}

function sameIds(a: PanelLayout[], b: PanelLayout[]): boolean {
  return a.length === b.length && new Set(a.map((p) => p.i)).size === a.length && b.every((d) => a.some((p) => p.i === d.i));
}

export function loadLayouts(workspace: string, defaults: Layouts, storage: StorageLike | null = browserStorage()): Layouts {
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(keyFor(workspace));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== VERSION || typeof parsed.layouts !== "object" || parsed.layouts === null) return defaults;
    const stored = parsed.layouts as Record<string, unknown>;
    const result: Layouts = {};
    for (const [breakpoint, panels] of Object.entries(defaults)) {
      const candidate = stored[breakpoint];
      if (!Array.isArray(candidate) || !candidate.every(validPanel) || !sameIds(candidate, panels)) return defaults;
      result[breakpoint] = candidate;
    }
    return result;
  } catch {
    return defaults;
  }
}

export function saveLayouts(workspace: string, layouts: Layouts, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(workspace), JSON.stringify({ v: VERSION, layouts }));
  } catch {
    // quota or blocked storage: the layout simply won't persist
  }
}

export function resetLayouts(workspace: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(workspace));
  } catch {
    // nothing to clean up
  }
}
