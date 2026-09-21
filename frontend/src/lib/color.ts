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
