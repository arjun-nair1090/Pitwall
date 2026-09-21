export const FIRST_SEASON = 2018;

export type SessionCode = "FP1" | "FP2" | "FP3" | "Q" | "SQ" | "SS" | "S" | "R";

export const SESSION_LABELS: Record<SessionCode, string> = {
  FP1: "Practice 1",
  FP2: "Practice 2",
  FP3: "Practice 3",
  Q: "Qualifying",
  SQ: "Sprint qualifying",
  SS: "Sprint shootout",
  S: "Sprint",
  R: "Race",
};

// One row of GET /api/v1/races/historical.
export interface CalendarRace {
  round: number | null;
  country: string;
  location: string;
  event_name: string;
  sessions?: SessionCode[];
  race_start_utc: string | null;
}

export interface Race extends CalendarRace {
  round: number;
}

// A race that started less than this long ago may still be running or unclassified.
const RACE_DURATION_MS = 3 * 60 * 60 * 1000;

export function seasonYears(now: Date = new Date()): number[] {
  const current = now.getFullYear();
  return Array.from({ length: current - FIRST_SEASON + 1 }, (_, i) => current - i);
}

// The races worth offering in a picker: finished, numbered and dated, in season order.
export function completedRaces(calendar: readonly CalendarRace[], now: number = Date.now()): Race[] {
  return calendar
    .filter((r): r is Race => {
      if (r.round === null || !r.race_start_utc) return false;
      const start = Date.parse(r.race_start_utc);
      return Number.isFinite(start) && start + RACE_DURATION_MS <= now;
    })
    .sort((a, b) => a.round - b.round);
}

export const raceLabel = (race: Race): string => `Round ${race.round}: ${race.event_name}`;

export function latestRound(races: readonly Race[]): number | null {
  return races.length ? Math.max(...races.map((r) => r.round)) : null;
}

export function availableSessions(race: Race): SessionCode[] {
  return race.sessions && race.sessions.length ? race.sessions : ["R"];
}

// "8 Mar 2026". Fixed to UTC so a race never shifts a day depending on the viewer's timezone.
export function formatRaceDate(iso: string | null | undefined): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return "Date to be confirmed";
  return new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function hasFinished(race: Pick<CalendarRace, "race_start_utc">, now: number = Date.now()): boolean {
  const start = race.race_start_utc ? Date.parse(race.race_start_utc) : NaN;
  return Number.isFinite(start) && start + RACE_DURATION_MS <= now;
}

// The earliest dated race that hasn't finished yet, or null when the season is over.
export function nextRace(calendar: readonly CalendarRace[], now: number = Date.now()): CalendarRace | null {
  let best: CalendarRace | null = null;
  let bestStart = Infinity;
  for (const r of calendar) {
    const start = r.race_start_utc ? Date.parse(r.race_start_utc) : NaN;
    if (!Number.isFinite(start) || hasFinished(r, now) || start >= bestStart) continue;
    best = r;
    bestStart = start;
  }
  return best;
}
