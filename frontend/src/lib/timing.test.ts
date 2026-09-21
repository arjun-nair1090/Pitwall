import { describe, expect, it } from "vitest";
import {
  classifyTime, formatDelta, formatGap, formatLapTime, formatSector,
  teamColor, TIMING_TEXT_CLASS, UNKNOWN_TEAM_COLOR,
} from "./timing";

describe("classifyTime", () => {
  it("is overall-best when it matches the overall best", () => {
    expect(classifyTime(89.117, 89.2, 89.117)).toBe("overall-best");
  });
  it("is personal-best when it matches only the personal best", () => {
    expect(classifyTime(89.2, 89.2, 89.117)).toBe("personal-best");
  });
  it("is off-pace when slower than both", () => {
    expect(classifyTime(90.5, 89.2, 89.117)).toBe("off-pace");
  });
  it("is none for missing, zero, negative or NaN times", () => {
    for (const bad of [null, undefined, 0, -1, NaN]) expect(classifyTime(bad, 89, 88)).toBe("none");
  });
  it("still classifies against a missing best", () => {
    expect(classifyTime(89, null, null)).toBe("off-pace");
  });
  it("maps every class to a Tailwind text class", () => {
    expect(TIMING_TEXT_CLASS["overall-best"]).toBe("text-timing-purple");
    expect(TIMING_TEXT_CLASS["personal-best"]).toBe("text-timing-green");
    expect(TIMING_TEXT_CLASS["off-pace"]).toBe("text-timing-yellow");
    expect(TIMING_TEXT_CLASS.none).toBe("text-chalk");
  });
});

describe("formatLapTime", () => {
  it("formats m:ss.mmm", () => expect(formatLapTime(89.526)).toBe("1:29.526"));
  it("never shows 60 seconds", () => expect(formatLapTime(59.9996)).toBe("1:00.000"));
  it("pads seconds and millis", () => expect(formatLapTime(61.005)).toBe("1:01.005"));
  it("renders a dash when missing", () => {
    expect(formatLapTime(null)).toBe("–");
    expect(formatLapTime(NaN)).toBe("–");
  });
});

describe("formatSector", () => {
  it("formats seconds under a minute as s.mmm", () => expect(formatSector(17.984)).toBe("17.984"));
  it("falls back to lap format at a minute or more", () => expect(formatSector(61.2)).toBe("1:01.200"));
  it("renders a dash when missing", () => expect(formatSector(undefined)).toBe("–"));
});

describe("formatGap", () => {
  it("prefixes a plus and shows three decimals", () => expect(formatGap(0.409)).toBe("+0.409"));
  it("switches to minutes at 60s", () => expect(formatGap(62.345)).toBe("+1:02.345"));
  it("keeps a zero gap", () => expect(formatGap(0)).toBe("+0.000"));
  it("never shows a negative zero", () => expect(formatGap(-0.0004)).toBe("+0.000"));
  it("renders a dash when missing", () => expect(formatGap(null)).toBe("–"));
});

describe("formatDelta", () => {
  it("always signs non-zero deltas", () => {
    expect(formatDelta(0.409)).toBe("+0.409");
    expect(formatDelta(-1.56)).toBe("−1.560");
  });
  it("leaves zero unsigned", () => expect(formatDelta(0)).toBe("0.000"));
  it("renders a dash when missing", () => expect(formatDelta(NaN)).toBe("–"));
});

describe("teamColor", () => {
  it("matches team names case-insensitively", () => {
    expect(teamColor("Red Bull Racing")).toBe("#3671C6");
    expect(teamColor("FERRARI")).toBe("#E8002D");
    expect(teamColor("McLaren")).toBe("#FF8000");
  });
  it("tells the sister team apart from Red Bull", () => {
    expect(teamColor("Visa Cash App RB")).toBe("#6692FF");
    expect(teamColor("Racing Bulls")).toBe("#6692FF");
  });
  it("falls back for unknown or missing teams", () => {
    expect(teamColor("Some New Team")).toBe(UNKNOWN_TEAM_COLOR);
    expect(teamColor(null)).toBe(UNKNOWN_TEAM_COLOR);
  });
});
