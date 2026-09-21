"use client";

import { useMemo } from "react";
import { readableTextColor } from "@/lib/color";
import { positionAt, type ReplayLap } from "@/lib/replay";
import { makeProjector } from "@/lib/trackProjection";

interface ReplayMapProps {
  lap: ReplayLap;
  seconds: number;
  selected: string | null;
  onSelect: (code: string) => void;
}

const SIZE = 500;

// The circuit with every car where it really was at this moment of the lap. Markers are buttons, so
// a car can be picked by mouse, touch or keyboard; the picked one is drawn last, on top.
export default function ReplayMap({ lap, seconds, selected, onSelect }: ReplayMapProps) {
  const outline = useMemo(() => lap.outline.x.map((x, i) => ({ x, y: lap.outline.y[i] })), [lap]);
  const project = useMemo(() => makeProjector(outline.length ? outline : lap.drivers.map((d) => ({ x: d.x[0] ?? 0, y: d.y[0] ?? 0 })), SIZE, 40), [lap, outline]);
  const path = useMemo(
    () => outline.map((p) => { const q = project(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" "),
    [outline, project],
  );

  const cars = lap.drivers
    .filter((d) => d.active)
    .map((d) => ({ d, at: positionAt(d, seconds, lap.step) }))
    .filter((c): c is { d: typeof c.d; at: { x: number; y: number } } => c.at !== null)
    .sort((a, b) => Number(a.d.code === selected) - Number(b.d.code === selected));

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="Circuit map with every car" className="mx-auto aspect-square h-full max-h-[70dvh] w-full">
      <polyline points={path} fill="none" stroke="#2A303A" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={path} fill="none" stroke="#6C7789" strokeWidth={1.5} strokeDasharray="4 6" strokeLinecap="round" strokeLinejoin="round" />
      {cars.map(({ d, at }) => {
        const p = project(at);
        const isSelected = d.code === selected;
        return (
          <g
            key={d.code}
            role="button"
            tabIndex={0}
            aria-label={`Select ${d.code}`}
            aria-pressed={isSelected}
            className="cursor-pointer"
            onClick={() => onSelect(d.code)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(d.code); } }}
          >
            <circle cx={p.x} cy={p.y} r={22} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={isSelected ? 10 : 6.5} fill={d.color} stroke="#E8EBEF" strokeWidth={isSelected ? 3 : 1.5} />
            <rect x={p.x + 10} y={p.y - 8} width={28} height={16} rx={3} fill={d.color} />
            <text x={p.x + 24} y={p.y + 4} fontSize={10} fontWeight={700} textAnchor="middle" fill={readableTextColor(d.color)} className="pointer-events-none">{d.code}</text>
          </g>
        );
      })}
    </svg>
  );
}
