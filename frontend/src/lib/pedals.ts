// One driver's pedal behaviour over their fastest lap, from POST /api/v1/telemetry/pedal-behavior.
export interface PedalRow {
  driver_code: string;
  name: string;
  team: string;
  color: string;
  lap_time: number;
  throttle_pct: number;
  brake_pct: number;
  both_pct: number;
  coast_pct: number;
}

export type PedalKey = "throttle_pct" | "brake_pct" | "both_pct" | "coast_pct";

// The four things a driver's feet can be doing. The colours are categories, not a scale, and every
// one is named in the legend so colour is never the only cue.
export const PEDAL_STATES: readonly { key: PedalKey; label: string; meaning: string; fill: string }[] = [
  { key: "throttle_pct", label: "Throttle only", meaning: "On the throttle and not braking: the car is accelerating or holding speed.", fill: "#E8EBEF" },
  { key: "brake_pct", label: "Brake only", meaning: "Braking with the throttle closed: slowing for a corner.", fill: "#E10600" },
  { key: "both_pct", label: "Trail braking", meaning: "Both pedals at once: carrying brake pressure into the corner while starting to get back on the power.", fill: "#B57BFF" },
  { key: "coast_pct", label: "Coasting", meaning: "Neither pedal: the car is rolling, which costs time.", fill: "#6C7789" },
];

// Rounds to one decimal so 100.00000000000001 reads as 100.0%.
export function formatShare(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

// Most time in the chosen state first; ties (and no chosen state) fall back to the quickest lap.
export function sortByState(rows: readonly PedalRow[], key: PedalKey | null): PedalRow[] {
  return [...rows].sort((a, b) => {
    if (key !== null && b[key] !== a[key]) return b[key] - a[key];
    return a.lap_time - b.lap_time;
  });
}
