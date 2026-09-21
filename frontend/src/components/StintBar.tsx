import React from "react";
import { getCompoundStyle } from "@/lib/compounds";
import type { Stint } from "@/lib/insights";

// Dark text on the light compounds (yellow, white, green), white on the dark ones (red, blue).
function labelColor(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const luminance = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luminance > 140 ? "rgba(0,0,0,0.85)" : "#ffffff";
}

interface StintBarProps {
  stints: Stint[];
  label?: string;
}

// A race strategy drawn as one bar: a segment per stint, sized by lap count and
// coloured by tyre compound (the same colours as everywhere else in the app).
export default function StintBar({ stints, label }: StintBarProps) {
  const total = stints.reduce((sum, s) => sum + s.laps, 0) || 1;
  const description = stints.map((s) => `${getCompoundStyle(s.compound).label} ${s.laps} laps`).join(", ");

  return (
    <div>
      {label && <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">{label}</div>}
      <div className="flex h-6 gap-0.5 rounded overflow-hidden" role="img" aria-label={description}>
        {stints.map((stint, i) => {
          const style = getCompoundStyle(stint.compound);
          return (
            <div
              key={i}
              title={`${style.label} · ${stint.laps} laps`}
              className="flex items-center justify-center text-[10px] font-bold min-w-[18px]"
              style={{ width: `${(stint.laps / total) * 100}%`, backgroundColor: style.color, color: labelColor(style.color) }}
            >
              {stint.laps}
            </div>
          );
        })}
      </div>
    </div>
  );
}
