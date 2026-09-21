import React from "react";
import { getCompoundStyle } from "@/lib/compounds";

interface CompoundBadgeProps {
  compound?: string | null;
  age?: number | null;
  showLabel?: boolean;
}

// F1-broadcast-style tire marker: a colored ring with the compound's letter.
export default function CompoundBadge({ compound, age, showLabel = false }: CompoundBadgeProps) {
  const style = getCompoundStyle(compound);
  return (
    <span className="inline-flex items-center gap-1.5" title={style.label}>
      <span
        className="inline-flex items-center justify-center h-5 w-5 rounded-full border-2 text-[10px] font-black leading-none"
        style={{ borderColor: style.color, color: style.color }}
      >
        {style.letter}
      </span>
      {showLabel && <span className="text-white/80 text-xs font-titillium">{style.label}</span>}
      {age ? <span className="text-white/50 text-[11px] font-mono-f1">{age}L</span> : null}
    </span>
  );
}
