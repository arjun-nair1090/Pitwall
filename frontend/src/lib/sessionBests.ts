// Best times seen so far, per driver and across the field. The live feed carries the current
// lap and sector times but not session personal bests, so "best" here means "fastest value seen
// since the page was opened".

export interface Bests {
  lap?: number;
  s1?: number;
  s2?: number;
  s3?: number;
}
export type BestKey = keyof Bests;
export const BEST_KEYS: readonly BestKey[] = ["lap", "s1", "s2", "s3"];

const usable = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

// Per-key minimum of the positive values in `prev` and `seen`. Pure: returns a new object.
export function mergeBests(prev: Bests, seen: Bests): Bests {
  const next: Bests = { ...prev };
  for (const key of BEST_KEYS) {
    const value = seen[key];
    if (usable(value) && (!usable(next[key]) || value < (next[key] as number))) next[key] = value;
  }
  return next;
}

// The fastest value per key across every driver's bests.
export function fieldBests(all: readonly Bests[]): Bests {
  return all.reduce<Bests>((acc, own) => mergeBests(acc, own), {});
}
