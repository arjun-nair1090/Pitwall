"use client";

import DataTable, { type Column } from "@/components/ui/DataTable";
import ErrorState from "@/components/ErrorState";
import Panel from "@/components/ui/Panel";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useStandings, type ConstructorStanding, type DriverStanding } from "@/hooks/useRaceData";
import { teamColor } from "@/lib/timing";

const DRIVER_COLUMNS: Column<DriverStanding>[] = [
  { key: "pos", header: "Pos", className: "w-12 text-mute", cell: (r) => r.position },
  {
    key: "driver",
    header: "Driver",
    cell: (r) => (
      <span className="flex flex-col">
        <span className="font-semibold">{r.driver_name}</span>
        <span className="text-xs text-faint">{r.driver_code}</span>
      </span>
    ),
  },
  { key: "team", header: "Team", className: "text-mute", cell: (r) => r.team_name },
  { key: "wins", header: "Wins", align: "right", className: "text-mute", cell: (r) => r.wins },
  { key: "points", header: "Points", align: "right", className: "font-semibold", cell: (r) => r.points },
];

const CONSTRUCTOR_COLUMNS: Column<ConstructorStanding>[] = [
  { key: "pos", header: "Pos", className: "w-12 text-mute", cell: (r) => r.position },
  { key: "team", header: "Team", className: "font-semibold", cell: (r) => r.team_name },
  { key: "wins", header: "Wins", align: "right", className: "text-mute", cell: (r) => r.wins },
  { key: "points", header: "Points", align: "right", className: "font-semibold", cell: (r) => r.points },
];

export default function StandingsView({ year }: { year: number }) {
  const standings = useStandings(year);

  if (standings.status === "loading" || standings.status === "idle") {
    return (
      <Loading label="Loading standings">
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1].map((panel) => (
            <div key={panel} className="space-y-3 rounded-panel border border-gantry bg-kerb p-6">
              <Skeleton className="mb-6 h-5 w-48" />
              {Array.from({ length: 10 }, (_, row) => (
                <div key={row} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Loading>
    );
  }
  if (standings.status === "error") {
    return (
      <ErrorState
        title={`No standings for ${year}`}
        message={standings.message}
        onRetry={standings.notFound ? undefined : standings.retry}
      />
    );
  }

  const { driver_standings: drivers, constructor_standings: constructors } = standings.data;
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Panel title="Drivers' championship" meta={`${drivers.length} drivers`}>
        <DataTable
          caption="Drivers' championship"
          columns={DRIVER_COLUMNS}
          rows={drivers}
          rowKey={(r) => `${r.position}-${r.driver_code}`}
          accent={(r) => teamColor(r.team_name)}
        />
      </Panel>
      <Panel title="Constructors' championship" meta={`${constructors.length} teams`}>
        <DataTable
          caption="Constructors' championship"
          columns={CONSTRUCTOR_COLUMNS}
          rows={constructors}
          rowKey={(r) => `${r.position}-${r.team_name}`}
          accent={(r) => teamColor(r.team_name)}
        />
      </Panel>
    </div>
  );
}
