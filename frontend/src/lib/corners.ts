// One driver's lap through one corner zone, as returned in `corners` by POST /api/v1/telemetry/compare.
export interface CornerMetrics {
  zone_time: number;
  apex_speed: number;
  entry_speed: number;
  exit_speed: number;
  // Metres before the corner where braking began; null when the driver didn't brake.
  brake_before_m: number | null;
}

// `time_delta` is driver 2's zone time minus driver 1's, so positive means driver 1 gained.
export interface CornerDuelRow {
  label: string;
  number: number;
  letter: string;
  x: number;
  y: number;
  angle: number;
  driver1: CornerMetrics;
  driver2: CornerMetrics;
  time_delta: number;
}

// Telemetry is sampled about every 10 m at top speed, so braking points closer than that are the same.
export const BRAKE_TIE_M = 10;

// A time delta that rounds to 0.000 s is level: it is shown as "Level" and never credited to a driver.
export const isLevel = (delta: number): boolean => Math.abs(delta).toFixed(3) === "0.000";

export function brakeVerdict(a: number | null, b: number | null, codeA: string, codeB: string): string {
  if (a === null && b === null) return "No braking";
  if (a === null) return `Only ${codeB} braked`;
  if (b === null) return `Only ${codeA} braked`;
  if (Math.abs(a - b) < BRAKE_TIE_M) return "Same braking point";
  // The later braker starts closer to the corner
  return a < b ? `${codeA} brakes ${Math.round(b - a)} m later` : `${codeB} brakes ${Math.round(a - b)} m later`;
}

// The corner where each driver gained most; null for a driver who gained nowhere.
export function biggestGains(rows: readonly CornerDuelRow[]): { first: CornerDuelRow | null; second: CornerDuelRow | null } {
  let first: CornerDuelRow | null = null;
  let second: CornerDuelRow | null = null;
  for (const r of rows) {
    if (isLevel(r.time_delta)) continue;
    if (r.time_delta > 0 && (!first || r.time_delta > first.time_delta)) first = r;
    if (r.time_delta < 0 && (!second || r.time_delta < second.time_delta)) second = r;
  }
  return { first, second };
}
