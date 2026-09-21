import { describe, expect, it } from "vitest";
import { contrastRatio, readableTextColor } from "./color";

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for identical colours", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#3671C6", "#3671C6")).toBeCloseTo(1, 5);
  });
});

describe("readableTextColor", () => {
  const DARK = "#13161B";
  const WHITE = "#FFFFFF";

  it("uses dark text on light team colours", () => {
    expect(readableTextColor("#F6C945")).toBe(DARK); // yellow
    expect(readableTextColor("#27F4D2")).toBe(DARK); // Mercedes
    expect(readableTextColor("#FF8000")).toBe(DARK); // McLaren
    expect(readableTextColor("#64C4FF")).toBe(DARK); // Williams
  });
  it("uses white text on dark team colours", () => {
    expect(readableTextColor("#3671C6")).toBe(WHITE); // Red Bull
    expect(readableTextColor("#0067AD")).toBe(WHITE); // wet tyre blue
  });
  it("always picks the higher-contrast option", () => {
    for (const hex of ["#E8002D", "#229971", "#FF87BC", "#6692FF", "#B6BABD", "#52E252"]) {
      const chosen = readableTextColor(hex);
      const other = chosen === DARK ? WHITE : DARK;
      expect(contrastRatio(hex, chosen)).toBeGreaterThanOrEqual(contrastRatio(hex, other));
    }
  });
  it("falls back to white for something that is not a hex colour", () => {
    expect(readableTextColor("teal")).toBe(WHITE);
    expect(readableTextColor("")).toBe(WHITE);
  });
});

describe("colorDistance and lighten", () => {
  it("measures how far apart two colours are", async () => {
    const { colorDistance } = await import("./color");
    expect(colorDistance("#000000", "#000000")).toBe(0);
    expect(colorDistance("#000000", "#FFFFFF")).toBeCloseTo(441.67, 1);
    expect(colorDistance("#3671C6", "3671c6")).toBe(0);
    expect(colorDistance("nope", "#FFFFFF")).toBe(Number.POSITIVE_INFINITY);
  });

  it("mixes towards white", async () => {
    const { lighten } = await import("./color");
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(lighten("#3671C6", 0)).toBe("#3671C6");
    expect(lighten("#3671C6", 1)).toBe("#FFFFFF");
    expect(lighten("nope", 0.5)).toBe("nope");
  });
});
