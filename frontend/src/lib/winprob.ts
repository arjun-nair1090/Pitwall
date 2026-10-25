import type { PitStatus } from "./pitwindow";

export interface WinProbDriver {
  code: string;
  name: string;
  team: string;
  color: string;
}

export interface WinProbRow {
  code: string;
  position: number;
  gap: number;
  projected_gap: number;
  probability: number;
  status: PitStatus;
  rule_breach: boolean;
  window_open: number | null;
}

export interface WinProbResult {
  year: number;
  round: number;
  session: string;
  total_laps: number;
  sims: number;
  sc_laps: number[];
  // A lap's odds needn't sum to 1: zeros are dropped and each is rounded.
  laps: { lap: number; odds: Record<string, number> }[];
  drivers: WinProbDriver[];
  at: { lap: number; rows: WinProbRow[] };
}

// A driver gets a line on the chart once they reach this chance on some lap.
const LINE_THRESHOLD = 0.05;

export interface ChartDriver extends WinProbDriver {
  dashed: boolean;
}

// Joins consecutive laps into [first, last] spans.
export function mergeLaps(laps: readonly number[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const lap of Array.from(new Set(laps)).sort((a, b) => a - b)) {
    const last = spans[spans.length - 1];
    if (last && lap === last[1] + 1) last[1] = lap;
    else spans.push([lap, lap]);
  }
  return spans;
}

// Drivers who reach the threshold, in payload order. The later car of a team is dashed, counted over
// every driver in the payload so a team-mate with no line still decides which car is second.
export function chartDrivers(data: WinProbResult): ChartDriver[] {
  const seen = new Map<string, number>();
  const styled = data.drivers.map((d) => {
    const nth = seen.get(d.team) ?? 0;
    seen.set(d.team, nth + 1);
    return { ...d, dashed: nth % 2 === 1 };
  });
  return styled.filter((d) => data.laps.some((l) => (l.odds[d.code] ?? 0) >= LINE_THRESHOLD));
}

export type OddsRow = { lap: number } & Record<string, number>;

// One chart row per lap; a driver dropped from a lap's odds is at 0.
export function oddsRows(data: WinProbResult, codes: readonly string[]): OddsRow[] {
  return data.laps.map((l) => {
    const row: OddsRow = { lap: l.lap };
    for (const code of codes) row[code] = l.odds[code] ?? 0;
    return row;
  });
}

const DASH = "—";

export function gapText(seconds: number | null): string {
  return seconds === null || seconds <= 0 ? DASH : `+${seconds.toFixed(1)} s`;
}

export function clampLap(lap: number, total: number | null): number {
  const capped = total === null ? lap : Math.min(lap, total);
  return Math.max(1, capped);
}
