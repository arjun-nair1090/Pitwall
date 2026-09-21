import { colorDistance, lighten } from "@/lib/color";

// One telemetry sample of a lap, as returned by POST /api/v1/telemetry/compare.
export interface TelemetryPoint {
  distance: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
  time: number;
  x: number;
  y: number;
  acceleration: number;
}

export const CHANNELS = ["speed", "throttle", "brake", "gear", "rpm", "drs", "acceleration"] as const;
export type Channel = (typeof CHANNELS)[number];

// Channels that jump between values rather than varying smoothly: blending gear 3 and 4 into 3.4
// (or brake on/off into 0.5) would invent a state the car was never in.
const STEPPED: ReadonlySet<Channel> = new Set<Channel>(["gear", "brake", "drs"]);

// One row per distance step, both drivers side by side, ready for a chart. `gap` is how much later
// B reached this point than A, in seconds: positive means A was ahead.
export type DuelRow = { distance: number; gap: number; speedDiff: number } & {
  [K in `a_${Channel}` | `b_${Channel}`]: number;
};

function valueAt(points: readonly TelemetryPoint[], distance: number, key: Channel | "time", stepped: boolean): number {
  const last = points.length - 1;
  if (distance <= points[0].distance) return points[0][key];
  if (distance >= points[last].distance) return points[last][key];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distance <= distance) lo = mid;
    else hi = mid;
  }
  const from = points[lo];
  const to = points[hi];
  if (stepped) return from[key];
  const span = to.distance - from.distance;
  const t = span > 0 ? (distance - from.distance) / span : 0;
  return from[key] + (to[key] - from[key]) * t;
}

// Puts both laps on the same distance grid (every `step` metres, across the stretch both cover) so
// every chart shares one x axis and lines up under the cursor.
export function buildDuelRows(a: readonly TelemetryPoint[], b: readonly TelemetryPoint[], step = 10): DuelRow[] {
  if (a.length === 0 || b.length === 0) return [];
  const start = Math.max(a[0].distance, b[0].distance);
  const end = Math.min(a[a.length - 1].distance, b[b.length - 1].distance);
  const rows: DuelRow[] = [];
  for (let distance = Math.ceil(start / step) * step; distance <= end; distance += step) {
    const row: Record<string, number> = { distance };
    for (const channel of CHANNELS) {
      row[`a_${channel}`] = valueAt(a, distance, channel, STEPPED.has(channel));
      row[`b_${channel}`] = valueAt(b, distance, channel, STEPPED.has(channel));
    }
    row.speedDiff = row.a_speed - row.b_speed;
    row.gap = valueAt(b, distance, "time", false) - valueAt(a, distance, "time", false);
    rows.push(row as DuelRow);
  }
  return rows;
}

export interface DominanceSegment {
  x: number;
  y: number;
  winner: 1 | 2;
  delta: number;
}

// Splits the lap into mini-sectors and says who carried more speed through each. Ties go to the
// first driver; positions come from the first driver's line.
export function dominanceSegments(a: readonly TelemetryPoint[], b: readonly TelemetryPoint[], sectorMetres = 50): DominanceSegment[] {
  if (a.length === 0 || b.length === 0) return [];
  const longest = Math.max(a[a.length - 1].distance, b[b.length - 1].distance);
  if (!(longest > 0)) return [];
  const count = Math.max(Math.floor(longest / sectorMetres), 1);
  const width = longest / count;
  const bucket = (distance: number) => Math.min(Math.floor(distance / width), count - 1);

  const blank = () => Array.from({ length: count }, () => ({ speed: 0, x: 0, y: 0, n: 0 }));
  const sumsA = blank();
  const sumsB = blank();
  for (const p of a) {
    const s = sumsA[bucket(p.distance)];
    s.speed += p.speed; s.x += p.x; s.y += p.y; s.n += 1;
  }
  for (const p of b) {
    const s = sumsB[bucket(p.distance)];
    s.speed += p.speed; s.n += 1;
  }

  const segments: DominanceSegment[] = [];
  for (let i = 0; i < count; i++) {
    if (sumsA[i].n === 0 || sumsB[i].n === 0) continue;
    const speedA = sumsA[i].speed / sumsA[i].n;
    const speedB = sumsB[i].speed / sumsB[i].n;
    segments.push({
      x: sumsA[i].x / sumsA[i].n,
      y: sumsA[i].y / sumsA[i].n,
      winner: speedA >= speedB ? 1 : 2,
      delta: Math.abs(speedA - speedB),
    });
  }
  return segments;
}

export interface DuelStyle {
  color1: string;
  color2: string;
  dash2: string | undefined;
  sameTeam: boolean;
}

// Teammates share a team colour, so two lines (or two map segments) in it can't be told apart.
// The second driver then gets a lighter tint and a dashed line: two cues, so colour alone
// never carries the difference.
const SAME_TEAM_DISTANCE = 40;

export function duelStyle(color1: string, color2: string): DuelStyle {
  const sameTeam = colorDistance(color1, color2) < SAME_TEAM_DISTANCE;
  return sameTeam
    ? { color1, color2: lighten(color2, 0.5), dash2: "6 4", sameTeam }
    : { color1, color2, dash2: undefined, sameTeam };
}
