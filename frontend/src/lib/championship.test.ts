import { describe, expect, it } from "vitest";
import { formatChance, formatGap, formatPoints, formatRaceDate, parseChampionshipParams, pointsAvailable } from "./championship";
import { DRIVERS } from "@/components/championship/fixtures";

describe("formatChance", () => {
  it("settles a clinched title at 100% however the rounding fell", () => {
    expect(formatChance(0.9996, "clinched")).toBe("100%");
    expect(formatChance(1, "clinched")).toBe("100%");
  });
  it("settles eliminated and not-racing drivers at 0%", () => {
    expect(formatChance(0, "eliminated")).toBe("0%");
    expect(formatChance(0.0004, "not racing")).toBe("0%");
  });
  it("never rounds a contender to a certainty or an impossibility", () => {
    expect(formatChance(1.0, "contender")).toBe(">99.9%");
    expect(formatChance(0.9996, "contender")).toBe(">99.9%");
    expect(formatChance(0, "contender")).toBe("<0.1%");
    expect(formatChance(0.0004, "contender")).toBe("<0.1%");
  });
  it("writes everything between with one decimal", () => {
    expect(formatChance(0.4567, "contender")).toBe("45.7%");
    expect(formatChance(0.001, "contender")).toBe("0.1%");
    expect(formatChance(0.4567)).toBe("45.7%");
  });
  it("writes only a true 0 or 1 plainly when there is no status", () => {
    expect(formatChance(0)).toBe("0%");
    expect(formatChance(1)).toBe("100%");
    expect(formatChance(0.0004)).toBe("<0.1%");
    expect(formatChance(0.9996)).toBe(">99.9%");
  });
});

describe("formatPoints and formatGap", () => {
  it("keeps half points and drops a needless decimal", () => {
    expect(formatPoints(12.5)).toBe("12.5");
    expect(formatPoints(340)).toBe("340");
    expect(formatPoints(12.499999999)).toBe("12.5");
  });
  it("shows a dash for the leader and a true minus for the rest", () => {
    expect(formatGap(0)).toBe("—");
    expect(formatGap(102)).toBe("−102");
    expect(formatGap(0.5)).toBe("−0.5");
  });
});

describe("formatRaceDate", () => {
  it("reads the day and month straight from the date", () => {
    expect(formatRaceDate("2026-10-25")).toBe("25 Oct");
    expect(formatRaceDate("2026-03-01")).toBe("1 Mar");
  });
  it("leaves something it can't read alone", () => expect(formatRaceDate("soon")).toBe("soon"));
});

describe("pointsAvailable", () => {
  it("reads the max remaining of a driver who is still racing", () => {
    expect(pointsAvailable(DRIVERS)).toBe(166);
  });
  it("skips a driver who is not racing", () => {
    const gone = { ...DRIVERS[0], status: "not racing" as const, max_points: DRIVERS[0].points };
    expect(pointsAvailable([gone, ...DRIVERS.slice(1)])).toBe(166);
  });
  it("is null when nobody is racing", () => expect(pointsAvailable([])).toBeNull());
});

describe("parseChampionshipParams", () => {
  const parse = (q: string) => parseChampionshipParams(new URLSearchParams(q), 2026);
  it("reads the year and the round", () => expect(parse("year=2024&round=7")).toEqual({ year: 2024, afterRound: 7 }));
  it("defaults to the current year and the latest round", () => expect(parse("")).toEqual({ year: 2026, afterRound: null }));
  it("falls back for a bad or out-of-range year", () => {
    expect(parse("year=abc").year).toBe(2026);
    expect(parse("year=2017").year).toBe(2026);
    expect(parse("year=2027").year).toBe(2026);
    expect(parse("year=2024.5").year).toBe(2026);
  });
  it("drops a bad round", () => {
    expect(parse("round=0").afterRound).toBeNull();
    expect(parse("round=x").afterRound).toBeNull();
    expect(parse("round=-3").afterRound).toBeNull();
  });
});
