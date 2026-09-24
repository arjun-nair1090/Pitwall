import { describe, expect, it } from "vitest";
import { parseRaceParams } from "./compareParams";

const parse = (query: string, now = new Date("2026-09-21")) => parseRaceParams(new URLSearchParams(query), now);

describe("parseRaceParams", () => {
  it("reads a race from the link's year and round", () => {
    expect(parse("year=2024&round=14")).toMatchObject({ year: 2024, round: 14, session: "R" });
  });

  it("reads the session and the two drivers", () => {
    expect(parse("year=2024&round=14&session=Q&d1=ver&d2=NOR")).toEqual({ year: 2024, round: 14, session: "Q", d1: "VER", d2: "NOR" });
  });

  it("falls back to this season, no round and the race when nothing is given", () => {
    expect(parse("")).toEqual({ year: 2026, round: null, session: "R", d1: null, d2: null });
  });

  it("ignores a year outside the data", () => {
    expect(parse("year=1999&round=3").year).toBe(2026);
    expect(parse("year=2999&round=3").year).toBe(2026);
    expect(parse("year=abc").year).toBe(2026);
  });

  it("ignores a round that isn't a positive whole number", () => {
    expect(parse("year=2024&round=0").round).toBeNull();
    expect(parse("year=2024&round=-2").round).toBeNull();
    expect(parse("year=2024&round=2.5").round).toBeNull();
    expect(parse("year=2024&round=x").round).toBeNull();
  });

  it("ignores an unknown session", () => {
    expect(parse("session=FP9").session).toBe("R");
  });

  it("ignores anything that isn't a three-letter driver code", () => {
    expect(parse("d1=<script>&d2=NORRIS")).toMatchObject({ d1: null, d2: null });
  });
});
