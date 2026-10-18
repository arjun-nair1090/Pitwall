"use client";

import axios from "axios";
import { useState } from "react";
import SessionPicker, { type RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import type { RaceBattlesResult } from "@/lib/battles";
import type { RaceParams } from "@/lib/compareParams";
import { SESSION_LABELS } from "@/lib/season";
import BattleTable from "./BattleTable";
import DriverMoves from "./DriverMoves";
import LapChart from "./LapChart";
import PassFeed from "./PassFeed";

const SESSIONS = ["R", "S"] as const;

const CAVEAT =
  "Positions are read at the end of each lap, so a pass and re-pass within one lap won't show, and passes during pit stops or behind a safety car don't count.";

// Every on-track pass, who gained at the start, and the fights that lasted. The analysis runs as
// soon as a session is chosen; the picker only offers races and sprints.
export default function BattlesPage({ initial }: { initial: RaceParams }) {
  // A link from another page may name qualifying or practice; analyse the race instead of asking
  // the server for a session it refuses.
  const session = initial.session === "S" ? "S" : "R";
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session });

  const analysis = useAsync<RaceBattlesResult>(
    sel.round === null
      ? null
      : () =>
          axios
            .post<RaceBattlesResult>("/api/v1/telemetry/race-battles", { year: sel.year, round: sel.round, session: sel.session })
            .then((res) => res.data),
    `battles-${sel.year}-${sel.round}-${sel.session}`,
  );

  return (
    <>
      <PageHeader
        title="Overtakes and battles"
        description="Every on-track pass, places gained at the start, and every fight within a second."
      />
      <Panel title="Choose a session" className="mb-4">
        <div className="p-4">
          <SessionPicker value={sel} onChange={setSel} allowedSessions={SESSIONS} />
        </div>
      </Panel>

      {analysis.status === "error" ? (
        <ErrorState title="Couldn't run the analysis" message={analysis.message} onRetry={analysis.notFound ? undefined : analysis.retry} />
      ) : analysis.status === "ready" ? (
        <div className="flex flex-col gap-4">
          <Panel title="Lap chart" meta={`${sel.year}, round ${sel.round}, ${SESSION_LABELS[sel.session]}`}>
            <div className="p-4">
              <LapChart drivers={analysis.data.drivers} overtakes={analysis.data.overtakes} totalLaps={analysis.data.total_laps} />
            </div>
          </Panel>
          <Panel title="Drivers">
            <div className="p-4">
              <DriverMoves drivers={analysis.data.drivers} />
            </div>
          </Panel>
          <Panel title="Passes">
            <div className="p-4">
              <PassFeed overtakes={analysis.data.overtakes} drivers={analysis.data.drivers} />
              <p className="mt-3 text-xs text-faint">{CAVEAT}</p>
            </div>
          </Panel>
          <Panel title="Battles">
            <div className="p-4">
              <BattleTable battles={analysis.data.battles} />
            </div>
          </Panel>
        </div>
      ) : (
        <Loading label="Analysing the session">
          <p className="mb-4 text-sm text-mute">
            {sel.round === null
              ? "Loading the season's races…"
              : "Reading every lap's running order. The first time a race is opened this can take up to a minute."}
          </p>
          <Skeleton className="h-96" />
        </Loading>
      )}
    </>
  );
}
