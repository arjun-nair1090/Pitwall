import { getCompoundStyle } from "@/lib/compounds";
import { lapRanges, planStatus, totalLaps, type Stint } from "@/lib/strategy";
import { cn } from "@/lib/cn";
import { readableTextColor } from "@/lib/color";

interface LapBudgetProps {
  stints: readonly Stint[];
  raceLaps: number | null;
}

// The race distance and how much of it the plan covers, as a bar split into stints. Each stint is
// drawn in its tyre's colour and lettered, so the tyre never rests on colour alone.
export default function LapBudget({ stints, raceLaps }: LapBudgetProps) {
  const status = planStatus(stints, raceLaps);
  const planned = totalLaps(stints);
  const ranges = lapRanges(stints);
  // An over-long plan is scaled so the whole plan still fits, with a marker where the race ends.
  const span = Math.max(raceLaps ?? planned, planned) || 1;
  const description = stints
    .map((s, i) => `${getCompoundStyle(s.compound).label}, laps ${ranges[i].start} to ${ranges[i].end}.`)
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-mute">
          Race distance{" "}
          <span className="font-display text-2xl font-black tabular-nums text-chalk">
            {raceLaps === null ? "–" : `${raceLaps} laps`}
          </span>
        </p>
        {raceLaps !== null && <p className="text-sm tabular-nums text-mute">{planned} of {raceLaps} laps planned</p>}
      </div>

      <div role="img" aria-label={description} className="relative flex h-9 w-full overflow-hidden rounded-control border border-edge bg-raised">
        {stints.map((stint, i) => {
          const style = getCompoundStyle(stint.compound);
          const width = (stint.laps / span) * 100;
          return (
            <div
              key={i}
              data-stint={i}
              style={{ width: `${width}%`, backgroundColor: style.color, color: readableTextColor(style.color) }}
              className={cn("flex min-w-0 items-center justify-center gap-1.5 border-r border-tarmac text-xs font-semibold tabular-nums", i === stints.length - 1 && "border-r-0")}
            >
              <span aria-hidden>{style.letter}</span>
              {width > 9 && <span aria-hidden>{stint.laps}</span>}
            </div>
          );
        })}
        {raceLaps !== null && planned > raceLaps && (
          <span
            data-race-end
            aria-hidden
            style={{ left: `${(raceLaps / span) * 100}%` }}
            className="absolute inset-y-0 w-0.5 bg-live"
          />
        )}
      </div>

      <p
        role={status.kind === "over" ? "alert" : undefined}
        className={cn("text-sm", status.kind === "over" ? "font-medium text-live-text" : "text-mute")}
      >
        {status.message}
      </p>
    </div>
  );
}
