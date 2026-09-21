import { describe, expect, it } from "vitest";
import { buildDuelRows, dominanceSegments, duelStyle, type TelemetryPoint } from "./duel";

const point = (distance: number, over: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  distance, speed: 100, throttle: 100, brake: 0, gear: 5, rpm: 10000, drs: 0, time: distance / 50, x: distance, y: 0, acceleration: 0, ...over,
});

const line = (n: number, step: number, make: (d: number) => Partial<TelemetryPoint> = () => ({})) =>
  Array.from({ length: n }, (_, i) => point(i * step, make(i * step)));

describe("buildDuelRows", () => {
  it("returns nothing when either lap is empty", () => {
    expect(buildDuelRows([], line(5, 10))).toEqual([]);
    expect(buildDuelRows(line(5, 10), [])).toEqual([]);
  });

  it("samples both laps on one shared distance grid", () => {
    const rows = buildDuelRows(line(11, 10), line(11, 10), 20);
    expect(rows.map((r) => r.distance)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("stops at the shorter lap", () => {
    const rows = buildDuelRows(line(11, 10), line(6, 10), 10);
    expect(rows[rows.length - 1].distance).toBe(50);
  });

  it("interpolates smooth channels linearly between samples", () => {
    const a = [point(0, { speed: 100 }), point(100, { speed: 200 })];
    const rows = buildDuelRows(a, a, 25);
    expect(rows.map((r) => r.a_speed)).toEqual([100, 125, 150, 175, 200]);
  });

  it("holds gear, brake and DRS at the last sample instead of blending them", () => {
    const a = [point(0, { gear: 3, brake: 1, drs: 0 }), point(100, { gear: 4, brake: 0, drs: 12 })];
    const rows = buildDuelRows(a, a, 50);
    expect(rows[1].a_gear).toBe(3);
    expect(rows[1].a_brake).toBe(1);
    expect(rows[1].a_drs).toBe(0);
    expect(rows[2].a_gear).toBe(4);
  });

  it("reports the speed difference as A minus B", () => {
    const a = line(3, 10, () => ({ speed: 300 }));
    const b = line(3, 10, () => ({ speed: 290 }));
    expect(buildDuelRows(a, b, 10).every((r) => r.speedDiff === 10)).toBe(true);
  });

  it("reports the gap as positive when A reached the point first", () => {
    const a = line(3, 100, (d) => ({ time: d / 50 }));   // 2 s per 100 m
    const b = line(3, 100, (d) => ({ time: d / 40 }));   // slower
    const rows = buildDuelRows(a, b, 100);
    expect(rows[0].gap).toBeCloseTo(0);
    expect(rows[1].gap).toBeCloseTo(0.5);
    expect(rows[2].gap).toBeCloseTo(1.0);
  });

  it("copes with a lap that starts slightly after distance zero", () => {
    const a = [point(0.2), point(100)];
    const b = [point(0.1), point(100)];
    const rows = buildDuelRows(a, b, 50);
    expect(rows[0].distance).toBe(50);   // first grid point inside both laps
    expect(rows.every((r) => r.a_speed !== null && r.b_speed !== null)).toBe(true);
  });
});

describe("dominanceSegments", () => {
  it("credits each mini-sector to the driver who carried more speed", () => {
    const a = line(20, 100, (d) => ({ speed: d < 1000 ? 300 : 200 }));
    const b = line(20, 100, (d) => ({ speed: d < 1000 ? 200 : 300 }));
    const segments = dominanceSegments(a, b, 200);
    expect(segments[0].winner).toBe(1);
    expect(segments[segments.length - 1].winner).toBe(2);
    expect(segments.every((s) => s.delta >= 0)).toBe(true);
  });

  it("gives ties to the first driver", () => {
    const a = line(20, 100);
    expect(new Set(dominanceSegments(a, a, 200).map((s) => s.winner))).toEqual(new Set([1]));
  });

  it("takes positions from the first driver's line", () => {
    const a = line(20, 100, () => ({ x: 5 }));
    const segments = dominanceSegments(a, line(20, 100, () => ({ x: 999 })), 200);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.x === 5)).toBe(true);
  });

  it("returns nothing for empty laps", () => {
    expect(dominanceSegments([], line(5, 10))).toEqual([]);
  });
});

describe("duelStyle", () => {
  it("keeps distinct team colours exactly as they are, both solid", () => {
    const style = duelStyle("#3671C6", "#FF8000");
    expect(style).toEqual({ color1: "#3671C6", color2: "#FF8000", dash2: undefined, sameTeam: false });
  });

  it("separates teammates: the second driver is lighter and dashed", () => {
    const style = duelStyle("#3671C6", "#3671C6");
    expect(style.sameTeam).toBe(true);
    expect(style.color1).toBe("#3671C6");
    expect(style.color2).not.toBe("#3671C6");
    expect(style.dash2).toBeDefined();
  });

  it("treats near-identical colours as the same team", () => {
    expect(duelStyle("#27F4D2", "#27F4D3").sameTeam).toBe(true);
  });
});
