// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHART, seriesColor, seriesDash } from "./chartTheme";

const css = readFileSync(new URL("../../design/tokens.css", import.meta.url), "utf8");
function hex(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`))!;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
}

describe("chartTheme", () => {
  it("uses the exact token colours", () => {
    expect(CHART.grid.stroke.toUpperCase()).toBe(hex("gantry"));
    expect(CHART.axis.tick.fill.toUpperCase()).toBe(hex("mute"));
    expect(CHART.tooltip.contentStyle.background.toUpperCase()).toBe(hex("raised"));
    expect(CHART.tooltip.contentStyle.color.toUpperCase()).toBe(hex("chalk"));
    expect(CHART.tooltip.cursor.stroke.toUpperCase()).toBe(hex("edge"));
  });
  it("uses the team colour when the team is known", () => {
    expect(seriesColor("McLaren", 0)).toBe("#FF8000");
  });
  it("falls back to neutral greys by index for unknown teams", () => {
    expect(seriesColor(null, 0)).toBe("#E8EBEF");
    expect(seriesColor("???", 1)).toBe("#A6AEBB");
  });
  it("dashes every second series so teammates stay distinguishable", () => {
    expect(seriesDash(0)).toBeUndefined();
    expect(seriesDash(1)).toBe("6 4");
  });
});
