// WCAG contrast helpers for text drawn on data colours (team colours, tyre compounds), where
// a fixed white or black label would be unreadable on some of them.

const HEX = /^#?([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const ca = channels(a);
  const cb = channels(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK = "#13161B"; // tarmac
const WHITE = "#FFFFFF";

// Whichever of tarmac or white reads better on `background`. Not a hex colour: white.
export function readableTextColor(background: string): string {
  if (!channels(background)) return WHITE;
  return contrastRatio(background, DARK) > contrastRatio(background, WHITE) ? DARK : WHITE;
}

// Straight-line distance between two colours in RGB space (0 to about 441). Non-hex input counts
// as far apart, so an unknown colour is never mistaken for a match.
export function colorDistance(a: string, b: string): number {
  const ca = channels(a);
  const cb = channels(b);
  if (!ca || !cb) return Number.POSITIVE_INFINITY;
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
}

// Mix a colour towards white. `amount` is 0 (unchanged) to 1 (white).
export function lighten(hex: string, amount: number): string {
  const c = channels(hex);
  if (!c) return hex;
  const mixed = c.map((v) => Math.round(v + (255 - v) * Math.min(Math.max(amount, 0), 1)));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
