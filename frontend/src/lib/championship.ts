const MINUS = "−";

export type DriverStatus = "clinched" | "eliminated" | "not racing" | "contender";
export type TeamStatus = "clinched" | "eliminated" | "contender";

export interface ChampionDriver {
  code: string;
  name: string;
  team: string;
  points: number;
  wins: number;
  title_probability: number;
  expected_points: number;
  points_p10: number;
  points_p90: number;
  max_points: number;
  status: DriverStatus;
}

export interface ChampionTeam {
  team: string;
  points: number;
  title_probability: number;
  expected_points: number;
  status: TeamStatus;
}

export interface RemainingRound {
  round: number;
  name: string;
  date: string;
  sprint: boolean;
}

export interface HistoryPoint {
  round: number;
  name: string;
  odds: Record<string, number>;
}

export interface ChampionshipResult {
  year: number;
  after_round: number;
  completed_rounds: number;
  total_rounds: number;
  simulations: number;
  rounds: { round: number; name: string }[];
  remaining: RemainingRound[];
  drivers: ChampionDriver[];
  constructors: ChampionTeam[];
  history: HistoryPoint[];
}

export const FIRST_YEAR = 2018;

// The server rounds odds to four places, so a driver who can still be caught can come back as
// exactly 1 and a contender as exactly 0. A status settles those; with none (the history chart),
// only a true 0 or 1 is written plainly.
export function formatChance(p: number, status?: DriverStatus | TeamStatus): string {
  if (status === "clinched") return "100%";
  if (status === "eliminated" || status === "not racing") return "0%";
  if (status === undefined) {
    if (p === 0) return "0%";
    if (p === 1) return "100%";
  }
  if (p >= 0.999) return ">99.9%";
  if (p < 0.001) return "<0.1%";
  return `${(p * 100).toFixed(1)}%`;
}

// Fractional points are real (Spa 2021 paid half points); whole ones carry no decimal.
export function formatPoints(points: number): string {
  return String(Math.round(points * 10) / 10);
}

export function formatGap(gap: number): string {
  return gap <= 0 ? "—" : `${MINUS}${formatPoints(gap)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-25" -> "25 Oct", read from the string so no time zone can move the day.
export function formatRaceDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!month || !day || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]}`;
}

// What a driver who is still racing could add: the same for every one of them, so any will do.
export function pointsAvailable(drivers: readonly ChampionDriver[]): number | null {
  const racing = drivers.find((d) => d.status !== "not racing");
  return racing ? Math.round((racing.max_points - racing.points) * 10) / 10 : null;
}

// A link can name ?year=&round=. A bad or out-of-range year falls back to the current one, a bad
// round to "latest".
export function parseChampionshipParams(
  params: URLSearchParams,
  currentYear: number = new Date().getFullYear(),
): { year: number; afterRound: number | null } {
  const y = params.get("year");
  const year = y !== null && /^\d{4}$/.test(y) && Number(y) >= FIRST_YEAR && Number(y) <= currentYear ? Number(y) : currentYear;
  const r = params.get("round");
  const round = r !== null && /^\d{1,2}$/.test(r) && Number(r) >= 1 ? Number(r) : null;
  return { year, afterRound: round };
}
