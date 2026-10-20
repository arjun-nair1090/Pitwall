// The race pace analysis (POST /api/v1/telemetry/race-pace). Every time is in seconds.

export interface FuelModel {
  start_kg: number;
  kg_per_lap: number;
  seconds_per_kg: number;
  seconds_per_lap: number;
  total_laps: number;
}

export interface PaceLap {
  lap: number;
  time: number;
  corrected: number;
  tyre_life: number | null;
}

export interface FitPoint {
  lap: number;
  time: number;
}

export interface PaceStint {
  stint: number;
  compound: string;
  start_lap: number;
  end_lap: number;
  deg_per_lap: number | null;
  fit: { from: FitPoint; to: FitPoint } | null;
  laps: PaceLap[];
}

export interface PaceDriver {
  code: string;
  name: string;
  team: string;
  color: string;
  pace: number | null;
  gap: number | null;
  clean_laps: number;
  stints: PaceStint[];
}

export interface CurvePoint {
  tyre_life: number;
  loss: number;
  laps: number;
}

export interface CompoundDegradation {
  compound: string;
  deg_per_lap: number;
  stints: number;
  laps: number;
  curve: CurvePoint[];
}

export interface RacePaceResult {
  fuel: FuelModel;
  drivers: PaceDriver[];
  compounds: CompoundDegradation[];
}

// Tyre wear as a signed slope; a value that rounds to zero carries no sign. A true minus sign
// keeps the figure aligned with the plus.
export function formatDeg(value: number | null): string {
  if (value === null) return "—";
  const text = Math.abs(value).toFixed(3);
  if (Number(text) === 0) return "0.000 s/lap";
  return `${value < 0 ? "−" : "+"}${text} s/lap`;
}

export function formatPaceGap(gap: number | null): string {
  if (gap === null) return "—";
  return gap === 0 ? "Fastest" : `+${gap.toFixed(3)} s`;
}
