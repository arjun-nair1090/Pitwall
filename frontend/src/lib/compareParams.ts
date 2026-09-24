import { FIRST_SEASON, SESSION_LABELS, type SessionCode } from "@/lib/season";

export interface RaceParams {
  year: number;
  round: number | null;
  session: SessionCode;
  d1: string | null;
  d2: string | null;
}

const isSession = (value: string | null): value is SessionCode => value !== null && value in SESSION_LABELS;
const wholeNumber = (value: string | null): number | null => (value !== null && /^\d+$/.test(value) ? Number(value) : null);
const driverCode = (value: string | null): string | null => (value !== null && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null);

// Reads which race a page was opened on from its link (?year=2024&round=14&session=R&d1=VER&d2=NOR).
// Anything missing or invalid falls back to a sensible default rather than breaking the page.
export function parseRaceParams(params: URLSearchParams, now: Date = new Date()): RaceParams {
  const year = wholeNumber(params.get("year"));
  const round = wholeNumber(params.get("round"));
  const session = params.get("session");
  return {
    year: year !== null && year >= FIRST_SEASON && year <= now.getFullYear() ? year : now.getFullYear(),
    round: round !== null && round > 0 ? round : null,
    session: isSession(session) ? session : "R",
    d1: driverCode(params.get("d1")),
    d2: driverCode(params.get("d2")),
  };
}
