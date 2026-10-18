export type BattleOutcome = "passed" | "pits" | "flag" | "neutralised" | "dropped";

export interface BattleDriver {
  code: string;
  name: string;
  team: string;
  color: string;
  grid: number | null;
  // The classified place; null for a retirement or a disqualification, which finish_note names.
  finish: number | null;
  finish_note: "DNF" | "DSQ" | null;
  start_gain: number | null;
  made: number;
  lost: number;
  // The race position at the end of each lap, lap 1 first; null once the driver has no lap.
  positions: (number | null)[];
}

export interface Overtake {
  lap: number;
  driver: string;
  passed: string;
  position: number;
}

export interface Battle {
  chaser: string;
  leader: string;
  start_lap: number;
  end_lap: number;
  laps: number;
  min_gap: number;
  outcome: BattleOutcome;
  outcome_lap: number | null;
}

export interface RaceBattlesResult {
  total_laps: number;
  drivers: BattleDriver[];
  overtakes: Overtake[];
  battles: Battle[];
}

// Places gained between the grid and the end of lap 1. A pit-lane start has no grid slot, so it
// reads as "Pit lane" rather than a gain of nearly the whole field.
export function formatStartGain(gain: number | null, grid: number | null): string {
  if (gain === null) return grid === null ? "Pit lane" : "—";
  if (gain > 0) return `+${gain}`;
  if (gain < 0) return `−${-gain}`;
  return "0";
}

export function outcomeText(b: Battle): string {
  switch (b.outcome) {
    case "passed": return `${b.chaser} passed on lap ${b.outcome_lap}`;
    case "pits": return `Ended in the pits on lap ${b.outcome_lap}`;
    case "flag": return "To the flag";
    case "neutralised": return `Safety car on lap ${b.outcome_lap}`;
    case "dropped": return "Dropped back";
  }
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}
