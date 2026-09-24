"use client";

import Link from "next/link";
import { ArrowLeft, Activity, Map as MapIcon } from "lucide-react";
import ErrorState from "@/components/ErrorState";
import TableSkeleton from "@/components/TableSkeleton";
import Button, { buttonClass } from "@/components/ui/Button";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import { useRaceResults, type ResultRow } from "@/hooks/useRaceData";
import { formatRaceDate, type CalendarRace } from "@/lib/season";
import { formatGap, formatRaceTime } from "@/lib/timing";

// The winner shows their race time, a car on the lead lap its gap to the winner, and anyone else
// (lapped, retired, disqualified) the reason. A lapped car's "gap" isn't comparable, so it isn't shown.
function timeOrStatus(row: ResultRow): string {
  if (row.position === 1 && row.race_time_seconds !== null) return formatRaceTime(row.race_time_seconds);
  if (row.gap_seconds !== null) return formatGap(row.gap_seconds);
  return row.status ?? "–";
}

const COLUMNS: Column<ResultRow>[] = [
  { key: "pos", header: "Pos", className: "w-12 text-mute", cell: (r) => r.position },
  {
    key: "driver",
    header: "Driver",
    cell: (r) => (
      <span className="flex flex-col">
        <span className="font-semibold">{r.name}</span>
        <span className="text-xs text-faint">{r.code}</span>
      </span>
    ),
  },
  { key: "team", header: "Team", className: "text-mute", cell: (r) => r.team },
  { key: "grid", header: "Grid", align: "right", className: "text-mute", cell: (r) => r.grid },
  { key: "time", header: "Time or status", align: "right", cell: (r) => timeOrStatus(r) },
  { key: "points", header: "Points", align: "right", className: "font-semibold", cell: (r) => (r.points === null ? "–" : r.points) },
];

interface RaceDetailProps {
  year: number;
  race: CalendarRace & { round: number };
  onBack: () => void;
}

export default function RaceDetail({ year, race, onBack }: RaceDetailProps) {
  const results = useRaceResults(year, race.round);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Button size="sm" variant="ghost" onClick={onBack} className="-ml-3 mb-2">
            <ArrowLeft aria-hidden className="h-4 w-4" />
            All races
          </Button>
          <h2 className="font-display text-2xl font-black leading-none text-chalk md:text-3xl">{race.event_name}</h2>
          <p className="mt-2 text-sm text-mute">
            Round {race.round} of {year}, {race.location}, {race.country}. {formatRaceDate(race.race_start_utc)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/map?year=${year}&round=${race.round}`} className={buttonClass({ variant: "primary" })}>
            <MapIcon aria-hidden className="h-4 w-4" />
            Replay on the track map
          </Link>
          <Link href={`/compare?year=${year}&round=${race.round}`} className={buttonClass({ variant: "secondary" })}>
            <Activity aria-hidden className="h-4 w-4" />
            Compare drivers
          </Link>
        </div>
      </div>

      {results.status === "loading" || results.status === "idle" ? (
        <TableSkeleton title={false} rows={12} columns={5} />
      ) : results.status === "error" ? (
        results.notFound ? (
          <EmptyState title="No results yet" description="No results have been published for this race yet. Check back after the race weekend." />
        ) : (
          <ErrorState title="Couldn't load the results" message={results.message} onRetry={results.retry} />
        )
      ) : (
        <Panel title="Race classification" meta={`${results.data.classification.length} drivers`}>
          <DataTable
            caption={`${race.event_name} ${year} classification`}
            columns={COLUMNS}
            rows={results.data.classification}
            rowKey={(r) => `${r.position}-${r.code}`}
            accent={(r) => r.color}
          />
        </Panel>
      )}
    </div>
  );
}
