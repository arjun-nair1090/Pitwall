import { ChevronLeft, ChevronRight } from "lucide-react";
import IconButton from "@/components/ui/IconButton";

interface LapStepperProps {
  lap: number;
  total: number | null;
  onChange: (lap: number) => void;
  label?: string;
}

// Steps through the laps of a race. The last lap is left out: nothing is left to decide on it.
export default function LapStepper({ lap, total, onChange, label = "Lap" }: LapStepperProps) {
  const last = total === null ? null : Math.max(1, total - 1);
  const off = last === null;
  const name = label.toLowerCase();
  return (
    <div className="flex items-center gap-3">
      <IconButton label={`Previous ${name}`} disabled={off || lap <= 1} onClick={() => onChange(lap - 1)}>
        <ChevronLeft aria-hidden className="h-4 w-4" />
      </IconButton>
      <input
        type="range"
        aria-label={label}
        min={1}
        max={last ?? Math.max(lap, 1)}
        value={lap}
        disabled={off}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-live"
      />
      <IconButton label={`Next ${name}`} disabled={last === null || lap >= last} onClick={() => onChange(lap + 1)}>
        <ChevronRight aria-hidden className="h-4 w-4" />
      </IconButton>
      <span className="w-28 shrink-0 text-sm tabular-nums text-chalk">{total === null ? `${label} ${lap}` : `${label} ${lap} of ${total}`}</span>
    </div>
  );
}
