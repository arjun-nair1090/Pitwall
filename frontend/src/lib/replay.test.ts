import { describe, expect, it } from "vitest";
import { channelsAt, clockText, positionAt, type ReplayDriver } from "./replay";

const driver = (over: Partial<ReplayDriver> = {}): ReplayDriver => ({
  code: "VER", number: "1", name: "Max", team: "RB", color: "#3671C6", active: true,
  x: [0, 100, 300], y: [0, 50, 50], speed: [100, 200, 300], throttle: [10, 20, 30], brake: [0, 1, 0], gear: [3, 4, 5], rpm: [9000, 10000, 11000], drs: [0, 0, 12],
  ...over,
});

describe("positionAt", () => {
  it("is exact on a frame", () => {
    expect(positionAt(driver(), 0.5, 0.5)).toEqual({ x: 100, y: 50 });
  });

  it("blends between frames so the car glides instead of jumping", () => {
    expect(positionAt(driver(), 0.25, 0.5)).toEqual({ x: 50, y: 25 });
    expect(positionAt(driver(), 0.75, 0.5)).toEqual({ x: 200, y: 50 });
  });

  it("stays on the first and last frame outside the lap", () => {
    expect(positionAt(driver(), -3, 0.5)).toEqual({ x: 0, y: 0 });
    expect(positionAt(driver(), 99, 0.5)).toEqual({ x: 300, y: 50 });
  });

  it("has no position for a driver with no data", () => {
    expect(positionAt(driver({ x: [], y: [] }), 1, 0.5)).toBeNull();
  });
});

describe("channelsAt", () => {
  it("reads the frame the moment falls in, holding it until the next", () => {
    expect(channelsAt(driver(), 0.49, 0.5)).toMatchObject({ speed: 100, gear: 3, brake: false, drs: false });
    expect(channelsAt(driver(), 0.5, 0.5)).toMatchObject({ speed: 200, gear: 4, brake: true });
  });

  it("reports DRS as open only when the flap is actually open (12 or more)", () => {
    expect(channelsAt(driver(), 1.0, 0.5)?.drs).toBe(true);
    expect(channelsAt(driver({ drs: [0, 8, 10] }), 0.5, 0.5)?.drs).toBe(false);
    expect(channelsAt(driver({ drs: [0, 8, 10] }), 1.0, 0.5)?.drs).toBe(true);
  });

  it("clamps to the last frame after the lap ends", () => {
    expect(channelsAt(driver(), 50, 0.5)).toMatchObject({ speed: 300, gear: 5 });
  });

  it("has no reading for a driver with no data", () => {
    expect(channelsAt(driver({ speed: [] }), 1, 0.5)).toBeNull();
  });
});

describe("clockText", () => {
  it("writes minutes and seconds", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(65.4)).toBe("1:05");
    expect(clockText(600)).toBe("10:00");
  });
  it("never goes negative", () => {
    expect(clockText(-4)).toBe("0:00");
  });
});
