export interface Point {
  x: number;
  y: number;
}

// Maps circuit coordinates into a square SVG viewBox: fitted to the box with `padding` on every
// side, proportions preserved and centred, y flipped so north is up.
export function makeProjector(points: readonly Point[], size = 500, padding = 50): (p: Point) => Point {
  if (points.length === 0) return () => ({ x: size / 2, y: size / 2 });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const room = size - padding * 2;
  const scale = Math.min(width > 0 ? room / width : Infinity, height > 0 ? room / height : Infinity);
  const k = Number.isFinite(scale) ? scale : 1;
  const offsetX = padding + (room - width * k) / 2;
  const offsetY = padding + (room - height * k) / 2;
  return (p) => ({
    x: offsetX + (p.x - minX) * k,
    y: size - (offsetY + (p.y - minY) * k),
  });
}
