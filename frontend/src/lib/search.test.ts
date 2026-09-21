import { describe, expect, it } from "vitest";
import { rankMatches } from "./search";

const items = [
  { label: "Live timing", keywords: ["race", "tower"] },
  { label: "Track map", keywords: ["circuit"] },
  { label: "Head to head", keywords: ["h2h", "compare"] },
  { label: "Strategy simulator", keywords: ["tyre", "pit"] },
];

describe("rankMatches", () => {
  it("returns everything in order for an empty query", () => {
    expect(rankMatches("  ", items)).toEqual(items);
  });
  it("ranks label prefix above word prefix above substring above keywords", () => {
    const list = [
      { label: "Xtiming", keywords: [] },
      { label: "Live timing", keywords: [] },
      { label: "Timing screen", keywords: [] },
      { label: "Other", keywords: ["timing"] },
    ];
    expect(rankMatches("tim", list).map((i) => i.label)).toEqual(["Timing screen", "Live timing", "Xtiming", "Other"]);
  });
  it("matches keywords", () => {
    expect(rankMatches("h2h", items).map((i) => i.label)).toEqual(["Head to head"]);
    expect(rankMatches("tyre", items).map((i) => i.label)).toEqual(["Strategy simulator"]);
  });
  it("ignores case and accents", () => {
    expect(rankMatches("LIVE", items)[0].label).toBe("Live timing");
    expect(rankMatches("Sérgio", [{ label: "Sergio Perez" }]).length).toBe(1);
  });
  it("returns nothing when nothing matches", () => {
    expect(rankMatches("zzz", items)).toEqual([]);
  });
  it("respects the limit", () => {
    expect(rankMatches("", items, 2)).toHaveLength(2);
  });
});
