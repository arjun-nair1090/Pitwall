import Pill from "@/components/ui/Pill";
import { formatPoints, formatRaceDate, type RemainingRound } from "@/lib/championship";

export default function RemainingRaces({ remaining, pointsLeft }: { remaining: RemainingRound[]; pointsLeft: number }) {
  if (remaining.length === 0) return <p className="p-4 text-sm text-mute">The season is over.</p>;
  return (
    <div className="p-4">
      <ul className="flex flex-col divide-y divide-gantry/60 text-sm">
        {remaining.map((r) => (
          <li key={r.round} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span>{`Round ${r.round} · ${r.name} · ${formatRaceDate(r.date)}`}</span>
            {r.sprint ? <Pill>Sprint</Pill> : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">{`Up to ${formatPoints(pointsLeft)} points still available to each driver`}</p>
    </div>
  );
}
