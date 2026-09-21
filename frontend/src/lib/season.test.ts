import { describe, expect, it } from "vitest";
import {
  availableSessions,
  completedRaces,
  formatRaceDate,
  hasFinished,
  latestRound,
  nextRace,
  raceLabel,
  SESSION_LABELS,
  seasonYears,
  type CalendarRace,
} from "./season";

const race = (round: number | null, name: string, start: string | null, extra: Partial<CalendarRace> = {}): CalendarRace => ({
  round, country: "X", location: "Y", event_name: name, race_start_utc: start, ...extra,
});

const NOW = Date.parse("2026-09-21T12:00:00Z");

describe("seasonYears", () => {
  it("runs from the current year back to 2018", () => {
    const years = seasonYears(new Date("2026-09-21"));
    expect(years[0]).toBe(2026);
    expect(years[years.length - 1]).toBe(2018);
    expect(years).toHaveLength(9);
  });
});

describe("completedRaces", () => {
  const calendar = [
    race(3, "Japanese Grand Prix", "2026-03-29T05:00:00Z"),
    race(1, "Australian Grand Prix", "2026-03-08T04:00:00Z"),
    race(15, "Future Grand Prix", "2026-10-25T13:00:00Z"),
    race(null, "Unnumbered Grand Prix", "2026-03-01T00:00:00Z"),
    race(2, "No Start Grand Prix", null),
  ];

  it("keeps only races that have finished and have a round number and a start time", () => {
    expect(completedRaces(calendar, NOW).map((r) => r.event_name)).toEqual(["Australian Grand Prix", "Japanese Grand Prix"]);
  });

  it("sorts by round", () => {
    expect(completedRaces(calendar, NOW).map((r) => r.round)).toEqual([1, 3]);
  });

  it("does not offer a race that started under three hours ago", () => {
    const justStarted = [race(9, "Live Grand Prix", "2026-09-21T10:00:00Z")];
    expect(completedRaces(justStarted, NOW)).toEqual([]);
    expect(completedRaces(justStarted, NOW + 2 * 3600_000).map((r) => r.round)).toEqual([9]);
  });
});

describe("raceLabel", () => {
  it("names the round and the event", () => {
    expect(raceLabel({ ...race(14, "Belgian Grand Prix", null), round: 14 })).toBe("Round 14: Belgian Grand Prix");
  });
});

describe("latestRound", () => {
  it("is the highest completed round, or null when none", () => {
    const races = completedRaces([race(1, "A", "2026-03-08T04:00:00Z"), race(2, "B", "2026-03-15T04:00:00Z")], NOW);
    expect(latestRound(races)).toBe(2);
    expect(latestRound([])).toBeNull();
  });
});

describe("availableSessions", () => {
  it("uses the weekend's own sessions", () => {
    expect(availableSessions({ ...race(1, "A", null, { sessions: ["FP1", "SQ", "S", "Q", "R"] }), round: 1 })).toEqual(["FP1", "SQ", "S", "Q", "R"]);
  });

  it("falls back to the race alone when the calendar doesn't say", () => {
    expect(availableSessions({ ...race(1, "A", null), round: 1 })).toEqual(["R"]);
    expect(availableSessions({ ...race(1, "A", null, { sessions: [] }), round: 1 })).toEqual(["R"]);
  });

  it("has a readable label for every session", () => {
    expect(SESSION_LABELS.R).toBe("Race");
    expect(SESSION_LABELS.SQ).toBe("Sprint qualifying");
  });
});

describe("formatRaceDate", () => {
  it("writes the day, short month and year", () => {
    expect(formatRaceDate("2026-03-08T04:00:00Z")).toBe("8 Mar 2026");
  });
  it("uses UTC, so a late-evening start doesn't slide to the next day", () => {
    expect(formatRaceDate("2026-03-08T23:30:00Z")).toBe("8 Mar 2026");
  });
  it("says so when the date isn't known", () => {
    expect(formatRaceDate(null)).toBe("Date to be confirmed");
    expect(formatRaceDate("not a date")).toBe("Date to be confirmed");
  });
});

describe("hasFinished", () => {
  it("is true once the race is at least three hours old", () => {
    expect(hasFinished({ race_start_utc: "2026-03-08T04:00:00Z" }, NOW)).toBe(true);
    expect(hasFinished({ race_start_utc: "2026-09-21T10:00:00Z" }, NOW)).toBe(false);
    expect(hasFinished({ race_start_utc: null }, NOW)).toBe(false);
  });
});

describe("nextRace", () => {
  const calendar = [
    race(1, "Past Grand Prix", "2026-03-08T04:00:00Z"),
    race(15, "Later Grand Prix", "2026-11-01T13:00:00Z"),
    race(14, "Sooner Grand Prix", "2026-10-05T13:00:00Z"),
    race(16, "Unscheduled Grand Prix", null),
  ];

  it("is the earliest race that hasn't finished", () => {
    expect(nextRace(calendar, NOW)?.event_name).toBe("Sooner Grand Prix");
  });

  it("still counts a race that has started but isn't over", () => {
    expect(nextRace([race(9, "Running Grand Prix", "2026-09-21T11:00:00Z")], NOW)?.event_name).toBe("Running Grand Prix");
  });

  it("is null when the season is over or nothing is dated", () => {
    expect(nextRace([race(1, "Past Grand Prix", "2026-03-08T04:00:00Z")], NOW)).toBeNull();
    expect(nextRace([race(2, "Unscheduled", null)], NOW)).toBeNull();
  });
});
