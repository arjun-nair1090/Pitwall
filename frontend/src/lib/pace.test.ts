import { describe, expect, it } from "vitest";
import { formatDeg, formatPaceGap } from "./pace";

describe("formatDeg", () => {
  it("signs the slope with three decimals", () => {
    expect(formatDeg(0.0816)).toBe("+0.082 s/lap");
    expect(formatDeg(-0.012)).toBe("−0.012 s/lap");
  });
  it("shows a dash when there is no slope", () => expect(formatDeg(null)).toBe("—"));
  it("shows no sign for a value that rounds to zero", () => {
    expect(formatDeg(0.0004)).toBe("0.000 s/lap");
    expect(formatDeg(-0.0004)).toBe("0.000 s/lap");
  });
});

describe("formatPaceGap", () => {
  it("names the fastest driver", () => expect(formatPaceGap(0)).toBe("Fastest"));
  it("shows the gap in seconds", () => expect(formatPaceGap(0.3124)).toBe("+0.312 s"));
  it("shows a dash when unranked", () => expect(formatPaceGap(null)).toBe("—"));
});
