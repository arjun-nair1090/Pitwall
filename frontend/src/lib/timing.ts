// F1 timing conventions in one place: purple = overall best, green = personal
// best, yellow = slower than both. Formatters render missing data as an en dash.

export type TimingClass = "overall-best" | "personal-best" | "off-pace" | "none";

const EPSILON = 1e-6;
const DASH = "–";
const MINUS = "−";

function isTime(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function classifyTime(
  time: number | null | undefined,
  personalBest: number | null | undefined,
  overallBest: number | null | undefined,
): TimingClass {
  if (!isTime(time)) return "none";
  if (isTime(overallBest) && time <= overallBest + EPSILON) return "overall-best";
  if (isTime(personalBest) && time <= personalBest + EPSILON) return "personal-best";
  return "off-pace";
}

// Full literal class names so Tailwind's scanner sees them.
export const TIMING_TEXT_CLASS: Record<TimingClass, string> = {
  "overall-best": "text-timing-purple",
  "personal-best": "text-timing-green",
  "off-pace": "text-timing-yellow",
  none: "text-chalk",
};

const pad = (n: number, width: number) => String(n).padStart(width, "0");

// Round to whole milliseconds first so 59.9996 becomes 1:00.000, never 0:60.000.
function fromMillis(total: number): string {
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return minutes > 0 ? `${minutes}:${pad(seconds, 2)}.${pad(millis, 3)}` : `${seconds}.${pad(millis, 3)}`;
}

export function formatLapTime(seconds: number | null | undefined): string {
  if (!isTime(seconds)) return DASH;
  const total = Math.round(seconds * 1000);
  const minutes = Math.floor(total / 60000);
  const rest = total % 60000;
  return `${minutes}:${pad(Math.floor(rest / 1000), 2)}.${pad(rest % 1000, 3)}`;
}

export function formatSector(seconds: number | null | undefined): string {
  if (!isTime(seconds)) return DASH;
  const total = Math.round(seconds * 1000);
  return total >= 60000 ? formatLapTime(seconds) : fromMillis(total);
}

export function formatGap(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DASH;
  const total = Math.round(Math.abs(seconds) * 1000);
  return `${seconds < 0 && total > 0 ? MINUS : "+"}${fromMillis(total)}`;
}

export function formatDelta(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DASH;
  const total = Math.round(Math.abs(seconds) * 1000);
  if (total === 0) return "0.000";
  return `${seconds < 0 ? MINUS : "+"}${fromMillis(total)}`;
}

export const UNKNOWN_TEAM_COLOR = "#8790A0";

// Order matters: the sister-team names are checked before "red bull".
const TEAM_COLORS: ReadonlyArray<readonly [string, string]> = [
  ["visa cash app rb", "#6692FF"],
  ["racing bulls", "#6692FF"],
  ["alphatauri", "#6692FF"],
  ["toro rosso", "#6692FF"],
  ["red bull", "#3671C6"],
  ["ferrari", "#E8002D"],
  ["mercedes", "#27F4D2"],
  ["mclaren", "#FF8000"],
  ["aston martin", "#229971"],
  ["alpine", "#FF87BC"],
  ["williams", "#64C4FF"],
  ["alfa romeo", "#52E252"],
  ["sauber", "#52E252"],
  ["haas", "#B6BABD"],
];

export function teamColor(team: string | null | undefined): string {
  if (!team) return UNKNOWN_TEAM_COLOR;
  const name = team.toLowerCase();
  return TEAM_COLORS.find(([needle]) => name.includes(needle))?.[1] ?? UNKNOWN_TEAM_COLOR;
}
