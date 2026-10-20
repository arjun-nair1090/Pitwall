import { describe, expect, it } from "vitest";
import { WIN_PROB } from "@/components/winprob/fixtures";
import { chartDrivers, clampLap, gapText, mergeLaps, oddsRows } from "./winprob";

describe("mergeLaps", () => {
  it("joins consecutive laps into one span and keeps a gap as two", () => {
    expect(mergeLaps([1, 39, 40, 41, 42])).toEqual([[1, 1], [39, 42]]);
  });
  it("sorts and de-duplicates", () => expect(mergeLaps([5, 3, 4, 4, 9])).toEqual([[3, 5], [9, 9]]));
  it("is empty for none", () => expect(mergeLaps([])).toEqual([]));
});

describe("chartDrivers", () => {
  const styled = chartDrivers(WIN_PROB);
  it("keeps drivers who reach 5% on some lap, in payload order", () =>
    expect(styled.map((s) => s.code)).toEqual(["NOR", "PER", "LEC", "VER"]));
  it("counts exactly 5% as reaching it, and 4.99% as not", () => {
    const at = (p: number) => ({ ...WIN_PROB, laps: WIN_PROB.laps.map((l) => (l.lap === 5 ? { ...l, odds: { ...l.odds, ALB: p } } : l)) });
    expect(chartDrivers(at(0.05)).map((s) => s.code)).toContain("ALB");
    expect(chartDrivers(at(0.0499)).map((s) => s.code)).not.toContain("ALB");
  });
  it("dashes the team-mate who comes later in the drivers list", () =>
    expect(styled.map((s) => s.dashed)).toEqual([false, false, false, true]));
  it("dashes by order in the payload, not by whether the first car is charted", () => {
    const flipped = { ...WIN_PROB, drivers: [WIN_PROB.drivers[3], ...WIN_PROB.drivers.filter((d) => d.code !== "VER")] };
    const s = chartDrivers(flipped);
    expect(s.find((x) => x.code === "VER")?.dashed).toBe(false);
    expect(s.find((x) => x.code === "PER")?.dashed).toBe(true);
  });
});

describe("oddsRows", () => {
  it("gives every lap a number for each charted driver, zero where the odds were dropped", () => {
    const rows = oddsRows(WIN_PROB, ["NOR", "VER"]);
    expect(rows).toHaveLength(6);
    expect(rows[5]).toEqual({ lap: 6, NOR: 0, VER: 1 });
    expect(rows[0]).toEqual({ lap: 1, NOR: 0.3, VER: 0.15 });
  });
});

describe("gapText", () => {
  it("shows a seconds gap with a plus", () => expect(gapText(3.44)).toBe("+3.4 s"));
  it("shows a dash for the leader", () => expect(gapText(0)).toBe("—"));
  it("shows a dash for none", () => expect(gapText(null)).toBe("—"));
});

describe("clampLap", () => {
  it("keeps a lap inside 1 to the total", () => {
    expect(clampLap(0, 60)).toBe(1);
    expect(clampLap(61, 60)).toBe(60);
    expect(clampLap(30, 60)).toBe(30);
  });
  it("leaves the lap alone while the total is unknown", () => expect(clampLap(99, null)).toBe(99));
});
