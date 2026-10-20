import type { PitStatus, Verdict } from "@/lib/pitwindow";

export interface CarRef {
  number: number;
  code: string;
}

export interface Battle {
  ahead: CarRef;
  behind: CarRef;
  gap: number;
  // Seconds a lap the chaser is gaining, from the laps both ran clean; null before there are enough.
  closing: number | null;
  laps_compared: number;
  in_drs: boolean;
  laps_to_drs: number | null;
}

export interface Neighbour {
  code: string;
  gap: number;
}

export interface RejoinForecast extends CarRef {
  position: number;
  rejoin_position: number;
  positions_lost: number;
  ahead: Neighbour | null;
  behind: Neighbour | null;
  traffic: boolean;
  // The pit window, once the tyre model has the laps for it.
  status?: PitStatus;
  window?: { open: number; close: number } | null;
  early: boolean | null;
}

export interface CutOdds {
  gain: number;
  margin: number;
  verdict: Verdict;
  compound: string;
}

export interface PitDuel {
  chaser: CarRef;
  leader: CarRef;
  gap: number;
  undercut: CutOdds | null;
  overcut: CutOdds | null;
}

export type PitLossSource = "measured" | "last_year" | "default";

export type RaceStrategy =
  | { live: false }
  | { live: true; applicable: false; session_name?: string | null }
  | {
      live: true;
      applicable: true;
      lap: number | null;
      total_laps: number | null;
      laps_remaining: number | null;
      neutralised: boolean;
      pit_loss: number;
      pit_loss_source: PitLossSource;
      battles: Battle[];
      pit_stops: RejoinForecast[];
      pit_duels: PitDuel[];
    };

export const PIT_LOSS_SOURCE: Record<PitLossSource, string> = {
  measured: "measured in this race",
  last_year: "from last year's race here",
  default: "typical figure until stops are measured",
};

const secs = (s: number) => `${s.toFixed(1)} s`;

export function battleWhen(b: Battle): string {
  if (b.in_drs) return "In DRS now";
  return b.laps_to_drs === 1 ? "DRS in ~1 lap" : `DRS in ~${b.laps_to_drs} laps`;
}

export function closingText(b: Battle): string {
  if (b.closing === null) return "";
  if (b.closing <= 0) return `pulling away ${secs(-b.closing)}/lap`;
  return `closing ${b.closing.toFixed(2)} s/lap`;
}

export function rejoinText(s: RejoinForecast): string {
  return s.positions_lost === 0 ? `P${s.rejoin_position}, no place lost` : `P${s.rejoin_position}, ${s.positions_lost} lost`;
}

export function neighbourText(s: RejoinForecast): string {
  const parts: string[] = [];
  if (s.ahead) parts.push(`${secs(s.ahead.gap)} behind ${s.ahead.code}`);
  if (s.behind) parts.push(`${secs(s.behind.gap)} ahead of ${s.behind.code}`);
  return parts.join(", ");
}

export function windowText(s: RejoinForecast): string | null {
  if (!s.status) return null;
  if (s.status === "window opens" && s.window) return `Window opens lap ${s.window.open}–${s.window.close}`;
  if (s.status === "window open" && s.window) return `Window open to lap ${s.window.close}`;
  return s.status.charAt(0).toUpperCase() + s.status.slice(1);
}

export function marginText(odds: CutOdds): string {
  return odds.margin >= 0 ? `by ${secs(odds.margin)}` : `short by ${secs(-odds.margin)}`;
}
