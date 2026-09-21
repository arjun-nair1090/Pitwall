// One lap of a past race on the real session clock, from GET /api/v1/telemetry/replay.
export interface ReplayDriver {
  code: string;
  number: string;
  name: string;
  team: string;
  color: string;
  active: boolean; // still racing on this lap (a retired car stays where it stopped)
  x: number[];
  y: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
}

export interface OrderRow {
  code: string;
  position: number;
  gap_to_leader: number | null;
  lap_time: number | null;
  compound: string | null;
  tyre_age: number | null;
  in_pit: boolean;
}

export interface ReplayLap {
  year: number;
  round: number | null;
  event_name: string;
  lap: number;
  total_laps: number;
  step: number;
  duration: number;
  frames: number;
  drivers: ReplayDriver[];
  order: OrderRow[];
  outline: { x: number[]; y: number[] };
}

// Frame index and how far towards the next one: playback time in seconds into the lap.
function locate(length: number, seconds: number, step: number): { index: number; blend: number } {
  const last = length - 1;
  const position = Math.min(Math.max(seconds / step, 0), last);
  const index = Math.min(Math.floor(position), last);
  return { index, blend: index === last ? 0 : position - index };
}

// Where a car was `seconds` into the lap, blended between frames so it glides.
export function positionAt(d: ReplayDriver, seconds: number, step: number): { x: number; y: number } | null {
  if (d.x.length === 0 || d.y.length === 0) return null;
  const { index, blend } = locate(d.x.length, seconds, step);
  const next = Math.min(index + 1, d.x.length - 1);
  return { x: d.x[index] + (d.x[next] - d.x[index]) * blend, y: d.y[index] + (d.y[next] - d.y[index]) * blend };
}

// What the car was doing at that moment. Values hold until the next frame; nothing is blended.
export function channelsAt(d: ReplayDriver, seconds: number, step: number) {
  if (d.speed.length === 0) return null;
  const { index } = locate(d.speed.length, seconds, step);
  return {
    speed: d.speed[index],
    throttle: d.throttle[index],
    brake: d.brake[index] === 1,
    gear: d.gear[index],
    rpm: d.rpm[index],
    drs: d.drs[index] >= 10, // FastF1 reports 10, 12 and 14 when the flap is open
  };
}

export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
