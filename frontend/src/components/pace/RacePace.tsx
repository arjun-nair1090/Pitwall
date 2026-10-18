"use client";

import axios from "axios";
import { useState } from "react";
import SessionPicker, { type RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import type { RaceParams } from "@/lib/compareParams";
import type { FuelModel, RacePaceResult } from "@/lib/pace";
import { SESSION_LABELS } from "@/lib/season";
import CompoundCurves from "./CompoundCurves";
import PaceRanking from "./PaceRanking";
import StintChart from "./StintChart";

const SESSIONS = ["R", "S"] as const;

function fuelNote(fuel: FuelModel): string {
  return `Fuel-corrected at ${fuel.seconds_per_lap.toFixed(3)} s a lap (${fuel.kg_per_lap.toFixed(2)} kg a lap at ${fuel.seconds_per_kg} s per kg): every lap is shown as if run on the final lap's fuel.`;
}

// Who was quickest over a race or sprint once fuel burn is taken out, and how each tyre wore. The
// analysis runs as soon as a session is chosen; the picker only offers races and sprints.
export default function RacePace({ initial }: { initial: RaceParams }) {
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session: initial.session });

  const analysis = useAsync<RacePaceResult>(
    sel.round === null
      ? null
      : () =>
          axios
            .post<{ data: RacePaceResult }>("/api/v1/telemetry/race-pace", { year: sel.year, round: sel.round, session: sel.session })
            .then((res) => res.data.data),
    `pace-${sel.year}-${sel.round}-${sel.session}`,
  );

  return (
    <>
      <PageHeader
        title="Race pace"
        description="Fuel-corrected race pace for every driver, and how fast each tyre compound wore."
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
          <Panel title="Race pace" meta={`${sel.year}, round ${sel.round}, ${SESSION_LABELS[sel.session]}`}>
            <div className="p-4">
              <PaceRanking drivers={analysis.data.drivers} />
              <p className="mt-3 text-xs text-faint">{fuelNote(analysis.data.fuel)}</p>
            </div>
          </Panel>
          <Panel title="Stints">
            <div className="p-4">
              <StintChart drivers={analysis.data.drivers} />
            </div>
          </Panel>
          <Panel title="Tyre degradation">
            <div className="p-4">
              <CompoundCurves compounds={analysis.data.compounds} />
            </div>
          </Panel>
        </div>
      ) : (
        <Loading label="Analysing the session">
          <p className="mb-4 text-sm text-mute">
            {sel.round === null
              ? "Loading the season's races…"
              : "Measuring every driver's clean laps. The first time a race is opened this can take up to a minute."}
          </p>
          <Skeleton className="h-96" />
        </Loading>
      )}
    </>
  );
}
