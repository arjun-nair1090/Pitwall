import { describe, expect, it } from "vitest";
import { formatStartGain, outcomeText, type Battle } from "./battles";

const base: Battle = { chaser: "NOR", leader: "VER", start_lap: 1, end_lap: 4, laps: 4, min_gap: 0.5, outcome: "flag", outcome_lap: 4 };

describe("formatStartGain", () => {
  it("signs a gain", () => expect(formatStartGain(3, 11)).toBe("+3"));
  it("uses a true minus for a loss", () => expect(formatStartGain(-2, 5)).toBe("−2"));
  it("shows no change as 0", () => expect(formatStartGain(0, 5)).toBe("0"));
  it("calls a missing grid slot the pit lane", () => expect(formatStartGain(null, null)).toBe("Pit lane"));
  it("dashes an unknown gain", () => expect(formatStartGain(null, 5)).toBe("—"));
});

describe("outcomeText", () => {
  it("names the pass", () => expect(outcomeText({ ...base, outcome: "passed", outcome_lap: 30 })).toBe("NOR passed on lap 30"));
  it("names the pit lap", () => expect(outcomeText({ ...base, outcome: "pits", outcome_lap: 20 })).toBe("Ended in the pits on lap 20"));
  it("says to the flag", () => expect(outcomeText(base)).toBe("To the flag"));
  it("names the safety car lap", () => expect(outcomeText({ ...base, outcome: "neutralised", outcome_lap: 12 })).toBe("Safety car on lap 12"));
  it("says dropped back", () => expect(outcomeText({ ...base, outcome: "dropped", outcome_lap: null })).toBe("Dropped back"));
});
