"use client";

import { useState, type PointerEvent } from "react";
import type { CornerConsistencyRow, CornerLap } from "@/lib/corners";

// The data-viz sequential blue, steps 600 to 100. On this dark surface the scale runs dark to light,
// so a lap close to the best recedes and the time lost through a corner is what stands out.
const RAMP = ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4", "#b7d3f6", "#cde2fb"];
const SURFACE = "#1E1E2A"; // kerb, the panel behind the grid: stroking each cell with it leaves a gap
const BEST = "#B57BFF"; // timing purple, the colour of the fastest time on a timing screen
const HOVER = "#F0F0F5";
const MUTE = "#ACACBE";
const GUTTER = 36;
const HEADER = 20;
const ROW = 12;
const MIN_COL = 10;
const CAP_PERCENTILE = 0.95;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// `t` from 0 (the corner's best) to 1 (the cap), interpolated between neighbouring ramp steps.
function heatColor(t: number): string {
  const pos = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const i = Math.floor(pos);
  if (i >= RAMP.length - 1) return RAMP[RAMP.length - 1];
  const a = rgb(RAMP[i]);
  const b = rgb(RAMP[i + 1]);
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * (pos - i)).toString(16).padStart(2, "0")).join("")}`;
}

// Linear interpolation between ranks, as numpy does it.
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  return lo + 1 < sorted.length ? sorted[lo] + (sorted[lo + 1] - sorted[lo]) * (pos - lo) : sorted[lo];
}

// Label the first lap and every fifth, but never two within three rows of each other.
function labelledRows(laps: readonly number[]): Set<number> {
  const rows = new Set<number>();
  let last = -Infinity;
  laps.forEach((lap, i) => {
    if ((i === 0 || lap % 5 === 0) && i - last >= 3) {
      rows.add(i);
      last = i;
    }
  });
  return rows;
}

const seconds = (s: number) => s.toFixed(3);

// Every clean lap (rows) through every corner (columns), coloured by the time lost to the best lap
// through that corner. The scale stops at the 95th percentile, so one lap stuck behind traffic
// doesn't wash out the differences between the rest.
export default function CornerHeatmap({ laps, corners }: { laps: readonly number[]; corners: readonly CornerConsistencyRow[] }) {
  const [hover, setHover] = useState<{ ci: number; ri: number } | null>(null);

  const rowOf = new Map(laps.map((lap, i) => [lap, i]));
  const columns = corners.map((c) => {
    const cells: (CornerLap | undefined)[] = new Array(laps.length);
    let best = -1;
    for (const p of c.per_lap) {
      const ri = rowOf.get(p.lap);
      if (ri === undefined) continue;
      cells[ri] = p;
      if (best === -1 || p.zone_time < cells[best]!.zone_time) best = ri;
    }
    return { corner: c, cells, best };
  });

  const deltas = corners.flatMap((c) => c.per_lap.map((p) => p.delta_to_best));
  const cap = percentile(deltas, CAP_PERCENTILE);
  const capped = deltas.some((d) => d > cap);
  const scale = cap > 0 ? cap : 1;
  const n = corners.length;
  const height = HEADER + laps.length * ROW;
  const ticks = labelledRows(laps);
  const x = (ci: number) => `${(ci / n) * 100}%`;
  const width = `${100 / n}%`;

  const name = (lap: number, label: string, p: CornerLap, best: boolean) =>
    best ? `Lap ${lap}, ${label}: the best, ${seconds(p.zone_time)} s` : `Lap ${lap}, ${label}: ${seconds(p.delta_to_best)} s off best`;

  const onPointerOver = (e: PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const ci = target.getAttribute("data-ci");
    const ri = target.getAttribute("data-ri");
    setHover(ci !== null && ri !== null ? { ci: Number(ci), ri: Number(ri) } : null);
  };

  const hovered = hover && columns[hover.ci]?.cells[hover.ri];

  return (
    <div>
      {/* Only a track with an unusual number of corners is too wide for a phone; that scrolls sideways. */}
      <div className="overflow-x-auto">
        <div className="flex" style={{ minWidth: GUTTER + n * MIN_COL }}>
          <svg aria-hidden width={GUTTER} height={height} className="block shrink-0">
            <text x={0} y={HEADER - 7} fontSize={10} fill={MUTE}>Lap</text>
            {laps.map((lap, ri) =>
              ticks.has(ri) ? (
                <text key={lap} x={GUTTER - 8} y={HEADER + ri * ROW + ROW - 2} fontSize={10} fill={MUTE} textAnchor="end">{lap}</text>
              ) : null,
            )}
          </svg>
          <div className="relative min-w-0 flex-1">
            <svg
              role="group"
              aria-label="Time lost to the best lap, corner by corner"
              width="100%"
              height={height}
              className="block"
              onPointerOver={onPointerOver}
              onPointerLeave={() => setHover(null)}
            >
              <g aria-hidden>
                {/* Every other corner is labelled on a phone, where the columns are too narrow for all of them */}
                {corners.map((c, ci) => (
                  <text
                    key={c.label}
                    x={`${((ci + 0.5) / n) * 100}%`}
                    y={HEADER - 7}
                    fontSize={10}
                    fill={MUTE}
                    textAnchor="middle"
                    className={ci % 2 === 1 ? "hidden sm:inline" : undefined}
                  >
                    {c.label}
                  </text>
                ))}
              </g>
              {columns.map(({ corner, cells, best }, ci) =>
                cells.map((p, ri) =>
                  p ? (
                    <rect
                      key={`${corner.label}-${laps[ri]}`}
                      data-cell=""
                      data-best={ri === best ? "" : undefined}
                      data-ci={ci}
                      data-ri={ri}
                      role="img"
                      aria-label={name(laps[ri], corner.label, p, ri === best)}
                      x={x(ci)}
                      y={HEADER + ri * ROW}
                      width={width}
                      height={ROW}
                      fill={heatColor(p.delta_to_best / scale)}
                      stroke={SURFACE}
                      strokeWidth={2}
                    />
                  ) : null,
                ),
              )}
              <g aria-hidden pointerEvents="none" fill="none" strokeWidth={2}>
                {columns.map(({ corner, best }, ci) =>
                  best === -1 ? null : <rect key={corner.label} x={x(ci)} y={HEADER + best * ROW} width={width} height={ROW} stroke={BEST} />,
                )}
                {hover && hovered && <rect x={x(hover.ci)} y={HEADER + hover.ri * ROW} width={width} height={ROW} stroke={HOVER} />}
              </g>
            </svg>
            {hover && hovered && (
              <div
                data-testid="heatmap-tooltip"
                aria-hidden
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-control border border-gantry bg-raised px-2 py-1 text-xs shadow-lg"
                style={{
                  // Keep the tooltip inside the grid: below the top rows, above the rest, and pinned to
                  // the nearer edge in the outer thirds.
                  left: `${((hover.ci + (hover.ci < n / 3 ? 0 : hover.ci >= (2 * n) / 3 ? 1 : 0.5)) / n) * 100}%`,
                  top: HEADER + hover.ri * ROW + (hover.ri < 3 ? ROW + 4 : -4),
                  transform: `translate(${hover.ci < n / 3 ? "0" : hover.ci >= (2 * n) / 3 ? "-100%" : "-50%"}, ${hover.ri < 3 ? "0" : "-100%"})`,
                }}
              >
                <div className="font-semibold tabular-nums text-chalk">
                  {hover.ri === columns[hover.ci].best ? "Best lap through the corner" : `${seconds(hovered.delta_to_best)} s off best`}
                </div>
                <div className="tabular-nums text-mute">{`Lap ${laps[hover.ri]}, ${corners[hover.ci].label}, ${seconds(hovered.zone_time)} s`}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div role="group" aria-label="Colour scale" className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs tabular-nums text-mute">
        <span>Time off the corner&apos;s best</span>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span>0.000 s</span>
          <span aria-hidden className="h-2.5 w-28 rounded-control" style={{ background: `linear-gradient(to right, ${RAMP.join(", ")})` }} />
          <span>{`${seconds(cap)} s${capped ? " or more" : ""}`}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden className="h-2.5 w-4 border-2" style={{ borderColor: BEST, backgroundColor: RAMP[0] }} />
          <span>Best lap through the corner</span>
        </div>
      </div>
    </div>
  );
}
