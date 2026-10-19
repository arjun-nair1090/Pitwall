"use client";

import axios from "axios";
import { useState } from "react";
import ErrorState from "@/components/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import { FIRST_YEAR, pointsAvailable, type ChampionshipResult } from "@/lib/championship";
import ConstructorsTable from "./ConstructorsTable";
import OddsTable from "./OddsTable";
import RemainingRaces from "./RemainingRaces";

const CAVEAT =
  "Each remaining race and sprint is simulated 10,000 times from every driver's finishing positions this season, weighted towards recent races, with their own retirement rate. It knows nothing about upgrades, grid penalties or team orders.";

// Who can still win the title, and how likely each is, from a simulation of the races left. Picking
// an earlier round replays the season as it stood then.
export default function ChampionshipPage({ initial }: { initial: { year: number; afterRound: number | null } }) {
  const [year, setYear] = useState(initial.year);
  const [afterRound, setAfterRound] = useState<number | null>(initial.afterRound);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - FIRST_YEAR + 1 }, (_, i) => currentYear - i);

  const odds = useAsync<ChampionshipResult>(
    () =>
      axios
        .post<ChampionshipResult>("/api/v1/championship/odds", { year, after_round: afterRound })
        .then((res) => res.data),
    `championship-${year}-${afterRound ?? "latest"}`,
  );

  return (
    <>
      <PageHeader
        title="Championship odds"
        description="Who can still win the title, and how likely each driver and team is, from a simulation of the races left."
      />
      <Panel title="Choose a season" className="mb-4">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <Select
            label="Season"
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setAfterRound(null);
            }}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select
            label="After round"
            value={odds.status === "ready" ? odds.data.after_round : (afterRound ?? "")}
            disabled={odds.status !== "ready"}
            onChange={(e) => setAfterRound(Number(e.target.value))}
          >
            {odds.status === "ready" ? (
              odds.data.rounds.map((r) => <option key={r.round} value={r.round}>{`After round ${r.round}: ${r.name}`}</option>)
            ) : (
              <option value="">Latest</option>
            )}
          </Select>
        </div>
      </Panel>

      {odds.status === "error" ? (
        <ErrorState title="Couldn't simulate the season" message={odds.message} onRetry={odds.notFound ? undefined : odds.retry} />
      ) : odds.status === "ready" ? (
        <div className="flex flex-col gap-4">
          <Panel title="Drivers' title odds" meta={`${odds.data.simulations.toLocaleString("en-US")} simulations`}>
            <div className="p-4">
              <OddsTable drivers={odds.data.drivers} seasonOver={odds.data.remaining.length === 0} />
              <p className="mt-3 text-xs text-faint">{CAVEAT}</p>
            </div>
          </Panel>
          <Panel title="Constructors' title odds">
            <div className="p-4">
              <ConstructorsTable teams={odds.data.constructors} />
            </div>
          </Panel>
          <Panel title="Races still to run" meta={`${odds.data.remaining.length} of ${odds.data.total_rounds}`}>
            <RemainingRaces remaining={odds.data.remaining} pointsLeft={pointsAvailable(odds.data.drivers)} />
          </Panel>
        </div>
      ) : (
        <Loading label="Simulating the season">
          <p className="mb-4 text-sm text-mute">
            Simulating the rest of the season… The first time a season is opened this can take up to a minute.
          </p>
          <Skeleton className="h-96" />
        </Loading>
      )}
    </>
  );
}
