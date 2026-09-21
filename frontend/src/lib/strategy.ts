import type { CompoundKey } from "@/lib/compounds";

export interface Stint {
  compound: CompoundKey;
  laps: number;
}

const COMPOUNDS: readonly CompoundKey[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const isCompound = (value: string): value is CompoundKey => (COMPOUNDS as readonly string[]).includes(value);

export const totalLaps = (stints: readonly Stint[]): number => stints.reduce((sum, s) => sum + s.laps, 0);
export const remainingLaps = (stints: readonly Stint[], raceLaps: number): number => raceLaps - totalLaps(stints);

export function lapRanges(stints: readonly Stint[]): { start: number; end: number }[] {
  let next = 1;
  return stints.map((s) => {
    const range = { start: next, end: next + s.laps - 1 };
    next += s.laps;
    return range;
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type PlanStatus = { kind: "complete" | "short" | "over" | "unknown"; message: string };

export function planStatus(stints: readonly Stint[], raceLaps: number | null): PlanStatus {
  if (raceLaps === null) return { kind: "unknown", message: "Choose a race to see its distance." };
  const left = remainingLaps(stints, raceLaps);
  if (left === 0) return { kind: "complete", message: `All ${raceLaps} laps planned.` };
  if (left > 0) return { kind: "short", message: `${plural(left, "lap")} left to plan.` };
  return { kind: "over", message: `${plural(-left, "lap")} over the ${raceLaps}-lap race.` };
}

// A stint can be lengthened only by the laps still unplanned, so the plan never outgrows the race.
export function setStintLaps(stints: readonly Stint[], index: number, laps: number, raceLaps: number): Stint[] {
  const room = Math.max(0, remainingLaps(stints, raceLaps));
  const wanted = Number.isFinite(laps) ? Math.round(laps) : 1;
  const clamped = Math.min(Math.max(wanted, 1), stints[index].laps + room);
  return stints.map((s, i) => (i === index ? { ...s, laps: clamped } : s));
}

export const setStintCompound = (stints: readonly Stint[], index: number, compound: CompoundKey): Stint[] =>
  stints.map((s, i) => (i === index ? { ...s, compound } : s));

// The rules require two different dry compounds, so a new stint starts on a different tyre.
function otherCompound(compound: CompoundKey): CompoundKey {
  if (compound === "MEDIUM") return "HARD";
  if (compound === "HARD" || compound === "SOFT") return "MEDIUM";
  return compound; // wet-weather tyres: stay on the same type
}

export function addStint(stints: readonly Stint[], raceLaps: number): Stint[] {
  const left = remainingLaps(stints, raceLaps);
  const last = stints[stints.length - 1];
  if (left > 0) return [...stints, { compound: otherCompound(last.compound), laps: left }];

  // Nothing left to plan: split the longest stint in two.
  let longest = 0;
  stints.forEach((s, i) => { if (s.laps > stints[longest].laps) longest = i; });
  const target = stints[longest];
  if (target.laps < 2) return [...stints];
  const second = Math.floor(target.laps / 2);
  return [
    ...stints.slice(0, longest),
    { ...target, laps: target.laps - second },
    { compound: otherCompound(target.compound), laps: second },
    ...stints.slice(longest + 1),
  ];
}

export const removeStint = (stints: readonly Stint[], index: number): Stint[] =>
  stints.length <= 1 ? [...stints] : stints.filter((_, i) => i !== index);

// Lengthens (or trims) the last stint so the plan covers the race exactly, where that's possible.
export function fillRemaining(stints: readonly Stint[], raceLaps: number): Stint[] {
  const left = remainingLaps(stints, raceLaps);
  const last = stints.length - 1;
  return stints.map((s, i) => (i === last ? { ...s, laps: Math.max(1, s.laps + left) } : s));
}

const PRESET_COMPOUNDS: Record<number, CompoundKey[]> = {
  1: ["HARD"],
  2: ["MEDIUM", "HARD"],
  3: ["SOFT", "MEDIUM", "HARD"],
  4: ["SOFT", "MEDIUM", "HARD", "MEDIUM"],
};

// A ready-made plan with the given number of pit stops, the race split as evenly as it goes.
export function presetPlan(stops: number, raceLaps: number): Stint[] {
  const count = Math.max(1, Math.min(stops + 1, 4, raceLaps));
  const base = Math.floor(raceLaps / count);
  const extra = raceLaps % count;
  return PRESET_COMPOUNDS[count].map((compound, i) => ({ compound, laps: base + (i < extra ? 1 : 0) }));
}

interface DriverStints {
  code: string;
  laps: number;
  status?: string | null;
  stints: { compound: string; laps: number }[];
}

// Why a driver's real strategy can't be copied or compared with, or null if it can.
export function strategyIssue(driver: DriverStints, raceLaps: number): string | null {
  if (driver.stints.some((s) => !isCompound(s.compound.toUpperCase()))) return "Tyre data unavailable";
  const down = raceLaps - driver.laps;
  if (down <= 0) return null;

  const status = driver.status ?? null;
  const lapped = status !== null ? /^(\+\d+ Laps?|Lapped)$/i.test(status) : down <= 2;
  if (lapped) return down === 1 ? "Finished a lap down" : `Finished ${down} laps down`;
  if (status === "Retired") return `Retired after ${driver.laps} of ${raceLaps} laps`;
  return status && status !== "Finished"
    ? `Retired (${status}) after ${driver.laps} of ${raceLaps} laps`
    : `Stopped after ${driver.laps} of ${raceLaps} laps`;
}

// The stints a driver actually ran, as an editable plan, when they covered the full distance.
export function driverStrategy(driver: DriverStints, raceLaps: number): Stint[] | null {
  if (strategyIssue(driver, raceLaps) !== null) return null;
  const stints = driver.stints.map((s) => ({ compound: s.compound.toUpperCase() as CompoundKey, laps: s.laps }));
  return totalLaps(stints) === raceLaps ? stints : null;
}

// One stint of a simulated plan, from POST /api/v1/strategy/simulate.
export interface SimulatedStint {
  compound: string;
  laps: number;
  start_lap: number;
  end_lap: number;
  seconds: number;
  avg_lap_seconds: number;
}

// What the model learned about a tyre from the race's own laps.
export interface CompoundModel {
  base_pace: number;
  deg_rate: number;
  fuel_rate?: number;
  sample_size: number;
}

export interface SimulationResult {
  predicted_total_seconds: number;
  predicted_avg_lap_seconds: number;
  num_pit_stops: number;
  pit_loss_seconds_used: number;
  total_laps: number;
  stints: SimulatedStint[];
  compound_stats: Record<string, CompoundModel>;
  actual_driver_total_seconds?: number;
  delta_seconds?: number;
}
