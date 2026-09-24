// @vitest-environment node
// Reads tokens.css with node:fs; jsdom's URL class is not accepted by fs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
type Rgb = [number, number, number];

function token(name: string): Rgb {
  const m = css.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`));
  if (!m) throw new Error(`token --${name} is missing from tokens.css`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = ["tarmac", "kerb", "raised"] as const;
const TEXT = ["chalk", "mute", "faint", "timing-purple", "timing-green", "timing-yellow", "f1-red-text"] as const;

describe("token contrast", () => {
  for (const ground of GROUNDS) {
    for (const text of TEXT) {
      it(`${text} on ${ground} meets AA text contrast (4.5:1)`, () => {
        expect(ratio(token(text), token(ground))).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`edge on ${ground} meets UI contrast (3:1)`, () => {
      expect(ratio(token("edge"), token(ground))).toBeGreaterThanOrEqual(3);
    });
  }
  it("white text on f1-red meets 4.5:1 (live badge)", () => {
    expect(ratio([255, 255, 255], token("f1-red"))).toBeGreaterThanOrEqual(4.5);
  });
  it("tarmac text on chalk meets 4.5:1 (primary button)", () => {
    expect(ratio(token("tarmac"), token("chalk"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("token exact values", () => {
  it("matches the approved palette", () => {
    expect(token("tarmac")).toEqual([21, 21, 30]);
    expect(token("kerb")).toEqual([30, 30, 42]);
    expect(token("chalk")).toEqual([240, 240, 245]);
    expect(token("timing-purple")).toEqual([181, 123, 255]);
  });
});
