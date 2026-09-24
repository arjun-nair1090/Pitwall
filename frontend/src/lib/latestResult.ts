import { formatGap } from "./timing";

// Shape of GET /api/v1/races/latest-result.
export interface ClassificationRow {
  position: number;
  code: string;
  name: string;
  team: string;
  grid: number;
  status: string | null;
  finished: boolean;
  race_time_seconds: number | null;
  gap_seconds: number | null;
}
export interface LatestResult {
  event: string;
  year: number;
  country: string;
  classification: ClassificationRow[];
}

export const gridOrder = (rows: readonly ClassificationRow[]): ClassificationRow[] =>
  [...rows].sort((a, b) => a.grid - b.grid || a.position - b.position);

export const finishOrder = (rows: readonly ClassificationRow[]): ClassificationRow[] =>
  [...rows].sort((a, b) => a.position - b.position);

export const positionsGained = (row: ClassificationRow): number => row.grid - row.position;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function formatRaceTime(seconds: number): string {
  const total = Math.round(seconds * 1000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  return `${hours}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(total % 1000, 3)}`;
}

export function resultLabel(row: ClassificationRow): string {
  if (row.position === 1 && row.race_time_seconds != null) return formatRaceTime(row.race_time_seconds);
  if (row.gap_seconds != null) return formatGap(row.gap_seconds);
  return row.status ?? "–";
}

export function winnerCaption(rows: readonly ClassificationRow[]): string {
  const winner = finishOrder(rows)[0];
  if (!winner) return "";
  if (winner.grid === 1) return `${winner.name} won from pole.`;
  const gained = positionsGained(winner);
  const up = gained > 0 ? `, up ${gained} ${gained === 1 ? "place" : "places"}` : "";
  return `${winner.name} won from P${winner.grid}${up}.`;
}
