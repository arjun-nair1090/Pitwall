"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import TableSkeleton from "@/components/TableSkeleton";
import ErrorState from "@/components/ErrorState";
import DataTable, { type Column } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { getApiErrorMessage } from "@/lib/apiError";
import { teamColor } from "@/lib/timing";

interface DriverStanding {
  position: number;
  points: number;
  wins: number;
  driver_name: string;
  driver_code: string;
  driver_number: number | null;
  team_name: string;
}

interface ConstructorStanding {
  position: number;
  points: number;
  wins: number;
  team_name: string;
}

interface StandingsResponse {
  year: number;
  driver_standings: DriverStanding[];
  constructor_standings: ConstructorStanding[];
}

// The driver's name links through to their season; everything else matches the archive's tables so
// the two places you can read a championship read the same.
const driverColumns = (year: number): Column<DriverStanding>[] => [
  { key: "pos", header: "Pos", className: "w-12 text-mute", cell: (r) => r.position },
  {
    key: "driver",
    header: "Driver",
    cell: (r) => (
      <Link href={`/drivers/${r.driver_code}?year=${year}`} className="flex flex-col hover:underline">
        <span className="font-semibold">{r.driver_name}</span>
        <span className="text-xs text-faint">{r.driver_code}</span>
      </Link>
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

export default function StatsPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStandings();
  }, [year]);

  const fetchStandings = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get<StandingsResponse>(`/api/v1/stats/standings?year=${year}`);
      setStandings(res.data);
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load standings."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full py-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <PageHeader
        title="Season stats"
        description="Drivers' and constructors' championship standings."
        actions={
          <Select label="Season" value={year} onChange={(e) => setYear(parseInt(e.target.value))} selectClassName="w-32 tabular-nums">
            {Array.from({ length: currentYear - 2018 + 1 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <TableSkeleton rows={10} columns={4} />
          <TableSkeleton rows={10} columns={4} />
        </div>
      ) : error ? (
        <ErrorState title="Couldn't load standings" message={error} onRetry={fetchStandings} />
      ) : standings ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel title="Drivers' championship" meta={`${standings.driver_standings.length} drivers`}>
            <DataTable
              caption="Drivers' championship"
              columns={driverColumns(year)}
              rows={standings.driver_standings}
              rowKey={(r) => `${r.position}-${r.driver_code}`}
              accent={(r) => teamColor(r.team_name)}
            />
          </Panel>
          <Panel title="Constructors' championship" meta={`${standings.constructor_standings.length} teams`}>
            <DataTable
              caption="Constructors' championship"
              columns={CONSTRUCTOR_COLUMNS}
              rows={standings.constructor_standings}
              rowKey={(r) => `${r.position}-${r.team_name}`}
              accent={(r) => teamColor(r.team_name)}
            />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
