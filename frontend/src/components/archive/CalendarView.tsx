"use client";

import { ChevronRight } from "lucide-react";
import ErrorState from "@/components/ErrorState";
import TableSkeleton from "@/components/TableSkeleton";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Pill from "@/components/ui/Pill";
import { useSeasonCalendar } from "@/hooks/useRaceData";
import { formatRaceDate, hasFinished, type CalendarRace } from "@/lib/season";

interface CalendarViewProps {
  year: number;
  onOpen: (race: CalendarRace & { round: number }) => void;
}

function RaceInfo({ race }: { race: CalendarRace }) {
  return (
    <>
      <span className="w-8 text-right font-display text-2xl font-black leading-none tabular-nums text-faint" aria-hidden>
        {race.round ?? "–"}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-chalk">{race.event_name}</span>
        <span className="block truncate text-xs text-mute">{race.location}, {race.country}</span>
      </span>
    </>
  );
}

export default function CalendarView({ year, onOpen }: CalendarViewProps) {
  const calendar = useSeasonCalendar(year);

  if (calendar.status === "loading" || calendar.status === "idle") return <TableSkeleton title={false} rows={10} columns={3} />;
  if (calendar.status === "error") {
    return <ErrorState title={`Couldn't load the ${year} calendar`} message={calendar.message} onRetry={calendar.retry} />;
  }
  if (calendar.data.length === 0) {
    return <EmptyState title={`No calendar for ${year}`} description="The schedule for this season isn't available." />;
  }

  const finished = calendar.data.filter((r) => hasFinished(r)).length;
  return (
    <Panel title={`${year} calendar`} meta={`${finished} of ${calendar.data.length} races completed`}>
      <ul className="divide-y divide-gantry/60">
        {calendar.data.map((race) => {
          const open = hasFinished(race) && race.round !== null;
          return (
            <li key={`${race.round}-${race.event_name}`}>
              {open ? (
                <button
                  type="button"
                  onClick={() => onOpen(race as CalendarRace & { round: number })}
                  className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 text-left transition-colors hover:bg-raised"
                >
                  <RaceInfo race={race} />
                  <span className="flex items-center gap-2 text-xs tabular-nums text-mute">
                    {formatRaceDate(race.race_start_utc)}
                    <ChevronRight aria-hidden className="h-4 w-4 text-faint" />
                  </span>
                </button>
              ) : (
                <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 opacity-70">
                  <RaceInfo race={race} />
                  <span className="flex items-center gap-2 text-xs tabular-nums text-mute">
                    {formatRaceDate(race.race_start_utc)}
                    <Pill>Upcoming</Pill>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
