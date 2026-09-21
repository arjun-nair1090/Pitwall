import { describe, expect, it } from "vitest";
import {
  addStint,
  driverStrategy,
  fillRemaining,
  lapRanges,
  planStatus,
  presetPlan,
  remainingLaps,
  removeStint,
  setStintCompound,
  setStintLaps,
  strategyIssue,
  totalLaps,
  type Stint,
} from "./strategy";

const plan = (...pairs: [Stint["compound"], number][]): Stint[] => pairs.map(([compound, laps]) => ({ compound, laps }));

describe("laps accounting", () => {
  const stints = plan(["MEDIUM", 20], ["HARD", 15]);

  it("adds the stints up and says how many laps are left", () => {
    expect(totalLaps(stints)).toBe(35);
    expect(remainingLaps(stints, 44)).toBe(9);
  });

  it("goes negative when the plan is longer than the race", () => {
    expect(remainingLaps(plan(["SOFT", 50]), 44)).toBe(-6);
  });

  it("gives each stint its lap range", () => {
    expect(lapRanges(stints)).toEqual([{ start: 1, end: 20 }, { start: 21, end: 35 }]);
  });
});

describe("planStatus", () => {
  it("is complete when the stints fill the race exactly", () => {
    expect(planStatus(plan(["MEDIUM", 20], ["HARD", 24]), 44)).toEqual({ kind: "complete", message: "All 44 laps planned." });
  });

  it("says how many laps to add when short", () => {
    expect(planStatus(plan(["MEDIUM", 20]), 44)).toEqual({ kind: "short", message: "24 laps left to plan." });
    expect(planStatus(plan(["MEDIUM", 43]), 44)).toEqual({ kind: "short", message: "1 lap left to plan." });
  });

  it("says how many laps to remove when over", () => {
    expect(planStatus(plan(["MEDIUM", 50]), 44)).toEqual({ kind: "over", message: "6 laps over the 44-lap race." });
  });

  it("doesn't judge a plan before the race distance is known", () => {
    expect(planStatus(plan(["MEDIUM", 20]), null)).toEqual({ kind: "unknown", message: "Choose a race to see its distance." });
  });
});

describe("editing", () => {
  it("never lets a stint push the plan past the race", () => {
    const next = setStintLaps(plan(["MEDIUM", 20], ["HARD", 20]), 0, 40, 44);
    expect(next[0].laps).toBe(24);   // 20 own + 4 remaining
  });

  it("never lets a stint be shorter than one lap or a fraction", () => {
    expect(setStintLaps(plan(["MEDIUM", 20]), 0, 0, 44)[0].laps).toBe(1);
    expect(setStintLaps(plan(["MEDIUM", 20]), 0, 7.6, 44)[0].laps).toBe(8);
    expect(setStintLaps(plan(["MEDIUM", 20]), 0, Number.NaN, 44)[0].laps).toBe(1);
  });

  it("changes a compound without touching the laps", () => {
    expect(setStintCompound(plan(["MEDIUM", 20], ["HARD", 24]), 1, "SOFT")).toEqual(plan(["MEDIUM", 20], ["SOFT", 24]));
  });

  it("does not modify the plan it was given", () => {
    const original = plan(["MEDIUM", 20]);
    setStintLaps(original, 0, 5, 44);
    setStintCompound(original, 0, "SOFT");
    expect(original).toEqual(plan(["MEDIUM", 20]));
  });

  it("adds a stint that takes the remaining laps, on a different tyre", () => {
    expect(addStint(plan(["MEDIUM", 20]), 44)).toEqual(plan(["MEDIUM", 20], ["HARD", 24]));
    expect(addStint(plan(["HARD", 20]), 44)).toEqual(plan(["HARD", 20], ["MEDIUM", 24]));
  });

  it("splits the longest stint when there is nothing left to add", () => {
    const next = addStint(plan(["MEDIUM", 14], ["HARD", 30]), 44);
    expect(next).toHaveLength(3);
    expect(totalLaps(next)).toBe(44);
    expect(next[1].laps + next[2].laps).toBe(30);
  });

  it("can't add a stint to a one-lap race", () => {
    expect(addStint(plan(["MEDIUM", 1]), 1)).toEqual(plan(["MEDIUM", 1]));
  });

  it("removes a stint but always keeps one", () => {
    expect(removeStint(plan(["MEDIUM", 20], ["HARD", 24]), 0)).toEqual(plan(["HARD", 24]));
    expect(removeStint(plan(["MEDIUM", 44]), 0)).toEqual(plan(["MEDIUM", 44]));
  });

  it("fills a short plan by lengthening the last stint", () => {
    expect(fillRemaining(plan(["MEDIUM", 20], ["HARD", 20]), 44)).toEqual(plan(["MEDIUM", 20], ["HARD", 24]));
  });

  it("trims an over-long plan from the last stint, leaving it at least one lap", () => {
    expect(fillRemaining(plan(["MEDIUM", 30], ["HARD", 20]), 44)).toEqual(plan(["MEDIUM", 30], ["HARD", 14]));
    expect(totalLaps(fillRemaining(plan(["MEDIUM", 60], ["HARD", 5]), 44))).toBeGreaterThan(44);   // can't be fixed by trimming alone
  });
});

describe("presetPlan", () => {
  it("builds a plan that exactly fills the race for every stop count", () => {
    for (const stops of [0, 1, 2, 3]) {
      for (const laps of [44, 57, 70, 53]) {
        const p = presetPlan(stops, laps);
        expect(p).toHaveLength(stops + 1);
        expect(totalLaps(p)).toBe(laps);
        expect(p.every((s) => s.laps >= 1)).toBe(true);
      }
    }
  });

  it("splits as evenly as possible, longer stints first", () => {
    expect(presetPlan(2, 44).map((s) => s.laps)).toEqual([15, 15, 14]);
  });

  it("uses at least two different dry compounds whenever there is a stop", () => {
    for (const stops of [1, 2, 3]) {
      expect(new Set(presetPlan(stops, 50).map((s) => s.compound)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("copes with a race shorter than the number of stints", () => {
    const p = presetPlan(3, 2);
    expect(totalLaps(p)).toBe(2);
    expect(p.every((s) => s.laps >= 1)).toBe(true);
  });
});

describe("driverStrategy", () => {
  const driver = (stints: { compound: string; laps: number }[], laps = stints.reduce((n, s) => n + s.laps, 0)) => ({ code: "VER", laps, stints });

  it("copies the stints a driver really ran when they cover the full distance", () => {
    expect(driverStrategy(driver([{ compound: "MEDIUM", laps: 11 }, { compound: "HARD", laps: 33 }]), 44)).toEqual(plan(["MEDIUM", 11], ["HARD", 33]));
  });

  it("reads compound names case-insensitively", () => {
    expect(driverStrategy(driver([{ compound: "Soft", laps: 44 }]), 44)).toEqual(plan(["SOFT", 44]));
  });

  it("has nothing to copy for a driver who didn't finish the distance", () => {
    expect(driverStrategy(driver([{ compound: "MEDIUM", laps: 20 }]), 44)).toBeNull();
  });

  it("has nothing to copy when a tyre isn't one the simulator knows", () => {
    expect(driverStrategy(driver([{ compound: "UNKNOWN", laps: 44 }]), 44)).toBeNull();
  });
});

describe("strategyIssue", () => {
  const driver = (laps: number, stints: { compound: string; laps: number }[]) => ({ code: "VER", laps, stints });

  it("is null for a driver who ran the whole race", () => {
    expect(strategyIssue(driver(44, [{ compound: "HARD", laps: 44 }]), 44)).toBeNull();
  });

  it("explains a retirement", () => {
    expect(strategyIssue(driver(20, [{ compound: "HARD", laps: 20 }]), 44)).toBe("Stopped after 20 of 44 laps");
  });

  it("explains a lapped finisher", () => {
    expect(strategyIssue(driver(43, [{ compound: "HARD", laps: 43 }]), 44)).toBe("Finished a lap down");
    expect(strategyIssue(driver(42, [{ compound: "HARD", laps: 42 }]), 44)).toBe("Finished 2 laps down");
  });

  it("explains a tyre the simulator doesn't know", () => {
    expect(strategyIssue(driver(44, [{ compound: "UNKNOWN", laps: 44 }]), 44)).toBe("Tyre data unavailable");
  });
});

describe("strategyIssue with a finishing status", () => {
  const driver = (laps: number, status: string | null) => ({ code: "VER", laps, status, stints: [{ compound: "HARD", laps }] });

  it("names the reason a driver stopped", () => {
    expect(strategyIssue(driver(42, "Engine"), 44)).toBe("Retired (Engine) after 42 of 44 laps");
  });

  it("doesn't repeat itself when the status is just 'Retired'", () => {
    expect(strategyIssue(driver(5, "Retired"), 44)).toBe("Retired after 5 of 44 laps");
  });

  it("treats a lapped-car status as a finish, not a retirement, however many laps down", () => {
    expect(strategyIssue(driver(43, "+1 Lap"), 44)).toBe("Finished a lap down");
    expect(strategyIssue(driver(40, "+4 Laps"), 44)).toBe("Finished 4 laps down");
    expect(strategyIssue(driver(43, "Lapped"), 44)).toBe("Finished a lap down");
  });

  it("does not doubt a driver whose status says they finished the full distance", () => {
    expect(strategyIssue(driver(44, "Finished"), 44)).toBeNull();
  });
});
