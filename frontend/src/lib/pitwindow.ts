import { getCompoundStyle } from "@/lib/compounds";

export type PitStatus = "box now" | "window open" | "window opens" | "stay out" | "wet";
export type Verdict = "likely" | "possible" | "unlikely";

export interface PitStop {
  lap: number;
  compound: string;
}

export interface PitDriver {
  code: string;
  name: string;
  team: string;
  color: string;
  position: number;
  compound: string;
  tyre_age: number;
  used: string[];
  gap_ahead: number | null;
  status: PitStatus;
  best: { stops: PitStop[]; cost: number } | null;
  window: { open: number; close: number } | null;
  cheap_stop: boolean;
  rule_breach: boolean;
  // The tyre the driver is on, or the first one the plan stops onto, has no fit of its own yet.
  early: boolean;
}

export interface Undercut {
  chaser: string;
  leader: string;
  gap: number;
  gain: number;
  margin: number;
  verdict: Verdict;
  compound: string;
}

export interface CompoundFit {
  compound: string;
  base: number;
  deg_per_lap: number;
  fitted: boolean;
  laps: number;
}

export interface PitWindowResult {
  year: number;
  round: number;
  session: string;
  lap: number;
  total_laps: number;
  laps_remaining: number;
  pit_loss: number;
  sc_lap: boolean;
  model: CompoundFit[];
  drivers: PitDriver[];
  undercuts: Undercut[];
}

// The lap asked for before the race length is known.
export const DEFAULT_LAP = 10;

const DASH = "—";
const compoundName = (compound: string) => getCompoundStyle(compound).label;

// The lap to open on once the race length is known: a third of the way in, never the last lap.
export function defaultLap(total: number): number {
  return Math.min(Math.max(1, Math.floor(total / 3)), Math.max(1, total - 1));
}

// The server's "Pick a lap from 1 to 43." names the last lap it will take. The wording is a contract
// with the backend (pinned there by test_the_bad_lap_wording_is_a_contract_with_the_page).
export function lastLapFromError(message: string): number | null {
  const m = /^Pick a lap from 1 to (\d+)\.$/.exec(message);
  return m ? Number(m[1]) : null;
}

export function planText(d: PitDriver): string {
  if (!d.best) return DASH;
  if (d.best.stops.length === 0) return "Stay out";
  return d.best.stops.map((s, i) => `${i === 0 ? "Box lap" : "lap"} ${s.lap} → ${compoundName(s.compound)}`).join(", ");
}

export function windowText(d: PitDriver): string {
  return d.window ? `Laps ${d.window.open}–${d.window.close}` : DASH;
}

export function statusLabel(status: PitStatus, ruleBreach: boolean, windowOpen: number | null): string {
  if (ruleBreach) return "Can't meet the two-compound rule";
  switch (status) {
    case "box now": return "Box now";
    case "window open": return "Window open";
    case "window opens": return windowOpen !== null ? `Window opens lap ${windowOpen}` : "Window opens";
    case "stay out": return "Stay out";
    case "wet": return "Wet tyres";
  }
}

export function statusText(d: PitDriver): string {
  return statusLabel(d.status, d.rule_breach, d.window ? d.window.open : null);
}

export function lapsText(n: number): string {
  return `${n} ${n === 1 ? "lap" : "laps"}`;
}

// No number: under a red flag the stop is free, so any figure would mislead.
export function cheapStopText(): string {
  return "Safety car or red flag: a cheap time to stop";
}

export function wearText(degPerLap: number): string {
  return `${degPerLap < 0 ? "-" : "+"}${Math.abs(degPerLap).toFixed(3)} s a lap`;
}

export function undercutLead(u: Undercut): string {
  const gain = u.gain >= 0 ? `undercut gains ${u.gain.toFixed(1)} s` : `undercut loses ${Math.abs(u.gain).toFixed(1)} s`;
  return `${u.chaser} on ${u.leader} · ${u.gap.toFixed(1)} s behind · ${gain} → `;
}

export const VERDICT_LABEL: Record<Verdict, string> = { likely: "Likely", possible: "Possible", unlikely: "Unlikely" };
