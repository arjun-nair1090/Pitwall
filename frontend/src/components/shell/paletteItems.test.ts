import { describe, expect, it } from "vitest";
import { driverItems, groupBySection, moduleItems, raceItems } from "./paletteItems";

describe("paletteItems", () => {
  it("lists every module as a page", () => {
    const items = moduleItems();
    expect(items.every((i) => i.section === "Pages")).toBe(true);
    expect(items.find((i) => i.label === "Live timing")?.href).toBe("/live");
  });
  it("builds driver items searchable by code and team", () => {
    const [item] = driverItems([{ code: "NOR", name: "Lando Norris", team: "McLaren" }]);
    expect(item).toMatchObject({ section: "Drivers", label: "Lando Norris", href: "/drivers/NOR", hint: "McLaren" });
    expect(item.keywords).toContain("NOR");
  });
  it("only offers races that have started, newest first as given, with encoded links", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    const items = raceItems(
      [
        { event_name: "Italian Grand Prix", country: "Italy", race_start_utc: "2026-09-06T13:00:00Z" },
        { event_name: "Singapore Grand Prix", country: "Singapore", race_start_utc: "2026-10-04T12:00:00Z" },
        { event_name: "Unknown Grand Prix", country: "X", race_start_utc: null },
      ],
      2026,
      now,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      section: "Races",
      label: "Italian Grand Prix",
      href: "/debrief?year=2026&race=Italian%20Grand%20Prix",
      hint: "2026",
    });
  });
  it("groups in a fixed order and records each group's start index", () => {
    const groups = groupBySection([
      { id: "r", section: "Races", label: "R", href: "/r" },
      { id: "p", section: "Pages", label: "P", href: "/p" },
      { id: "d", section: "Drivers", label: "D", href: "/d" },
      { id: "p2", section: "Pages", label: "P2", href: "/p2" },
    ]);
    expect(groups.map((g) => g.section)).toEqual(["Pages", "Drivers", "Races"]);
    expect(groups.map((g) => g.start)).toEqual([0, 2, 3]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["p", "p2"]);
  });
});
