"use client";

import axios from "axios";
import dynamic from "next/dynamic";
import { useState } from "react";
import SessionPicker, { type RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import ChartSkeleton from "@/components/charts/ChartSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import type { RaceParams } from "@/lib/compareParams";
import type { FuelModel, RacePaceResult } from "@/lib/pace";
import { SESSION_LABELS, type SessionCode } from "@/lib/season";
import PaceRanking from "./PaceRanking";

const CompoundCurves = dynamic(() => import("./CompoundCurves"), { ssr: false, loading: () => <ChartSkeleton height={320} /> });
const StintChart = dynamic(() => import("./StintChart"), { ssr: false, loading: () => <ChartSkeleton height={320} /> });

const SESSIONS = ["R", "S"] as const;

// The correction is a stated model, so the note says what it assumes. A sprint burns at the race's
// rate, so its fuel is stated over the race laps it would cover, which keeps the arithmetic true.
function fuelNote(fuel: FuelModel, session: SessionCode): string {
  const kg = Math.round(fuel.start_kg);
  if (session === "S") {
    return `Fuel-corrected assuming a sprint burns at a race's rate, ${kg} kg over ${Math.round(fuel.start_kg / fuel.kg_per_lap)} laps at ${fuel.seconds_per_kg} s per kg: ${fuel.seconds_per_lap.toFixed(3)} s a lap. Every lap is shown as if run on the final lap's fuel.`;
  }
  return `Fuel-corrected assuming ${kg} kg at the start burned evenly over ${fuel.total_laps} laps at ${fuel.seconds_per_kg} s per kg: ${fuel.seconds_per_lap.toFixed(3)} s a lap. Every lap is shown as if run on the final lap's fuel.`;
}

// Who was quickest over a race or sprint once fuel burn is taken out, and how each tyre wore. The
// analysis runs as soon as a session is chosen; the picker only offers races and sprints.
export default function RacePace({ initial }: { initial: RaceParams }) {
  // A link from another page may name qualifying or practice; analyse the race instead of asking
  // the server for a session it refuses.
  const session = initial.session === "S" ? "S" : "R";
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session });

  const analysis = useAsync<RacePaceResult>(
    sel.round === null
      ? null
      : () =>
          axios
            .post<RacePaceResult>("/api/v1/telemetry/race-pace", { year: sel.year, round: sel.round, session: sel.session })
            .then((res) => res.data),
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
              <p className="mt-3 text-xs text-faint">{fuelNote(analysis.data.fuel, sel.session)}</p>
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
        <Loading
          label="Analysing the session"
          message={sel.round === null
            ? "Loading the season's races…"
            : "Measuring every driver's clean laps. The first time a race is opened this can take up to a minute."}
        >
          <Skeleton className="h-96" />
        </Loading>
      )}
    </>
  );
}
