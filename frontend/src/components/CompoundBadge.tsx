import React from "react";
import { getCompoundStyle } from "@/lib/compounds";

interface CompoundBadgeProps {
  compound?: string | null;
  age?: number | null;
  showLabel?: boolean;
}

// F1-broadcast-style tyre marker: a coloured ring with the compound's letter. The letter
// (and the label when shown) means the compound is never conveyed by colour alone.
export default function CompoundBadge({ compound, age, showLabel = false }: CompoundBadgeProps) {
  const style = getCompoundStyle(compound);
  return (
    <span className="inline-flex items-center gap-1.5" title={style.label}>
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-black leading-none"
        style={{ borderColor: style.color, color: style.color }}
        aria-hidden={showLabel ? true : undefined}
      >
        {style.letter}
      </span>
      {showLabel ? <span className="text-xs text-mute">{style.label}</span> : <span className="sr-only">{style.label}</span>}
      {age ? <span className="text-[11px] tabular-nums text-faint">{age}L</span> : null}
    </span>
  );
}
