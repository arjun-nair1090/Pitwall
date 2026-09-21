import { describe, expect, it } from "vitest";
import { PEDAL_STATES, formatShare, sortByState, type PedalRow } from "./pedals";

const row = (code: string, over: Partial<PedalRow>): PedalRow => ({
  driver_code: code, name: code, team: "T", color: "#fff", lap_time: 100,
  throttle_pct: 80, brake_pct: 12, both_pct: 1, coast_pct: 7, ...over,
});

describe("PEDAL_STATES", () => {
  it("covers the four pedal states, each with a plain-language meaning", () => {
    expect(PEDAL_STATES.map((s) => s.key)).toEqual(["throttle_pct", "brake_pct", "both_pct", "coast_pct"]);
    for (const state of PEDAL_STATES) {
      expect(state.label.length).toBeGreaterThan(3);
      expect(state.meaning.length).toBeGreaterThan(20);
    }
  });
});

describe("formatShare", () => {
  it("shows one decimal place", () => {
    expect(formatShare(80.2719)).toBe("80.3%");
    expect(formatShare(0)).toBe("0.0%");
  });

  it("never shows floating-point noise", () => {
    expect(formatShare(100.00000000000001)).toBe("100.0%");
    expect(formatShare(99.99999999999999)).toBe("100.0%");
  });

  it("shows an en dash for a missing value", () => {
    expect(formatShare(null)).toBe("–");
    expect(formatShare(Number.NaN)).toBe("–");
  });
});

describe("sortByState", () => {
  const rows = [row("A", { brake_pct: 10 }), row("B", { brake_pct: 14 }), row("C", { brake_pct: 12 })];

  it("orders drivers from most to least time in that state", () => {
    expect(sortByState(rows, "brake_pct").map((r) => r.driver_code)).toEqual(["B", "C", "A"]);
  });

  it("leaves the original list untouched", () => {
    const copy = [...rows];
    sortByState(rows, "brake_pct");
    expect(rows).toEqual(copy);
  });

  it("keeps quickest-lap order for drivers who tie", () => {
    const tied = [row("X", { lap_time: 101, coast_pct: 5 }), row("Y", { lap_time: 99, coast_pct: 5 })];
    expect(sortByState(tied, "coast_pct").map((r) => r.driver_code)).toEqual(["Y", "X"]);
  });

  it("with no state, orders by lap time", () => {
    const byLap = [row("S", { lap_time: 103 }), row("F", { lap_time: 101 })];
    expect(sortByState(byLap, null).map((r) => r.driver_code)).toEqual(["F", "S"]);
  });
});
