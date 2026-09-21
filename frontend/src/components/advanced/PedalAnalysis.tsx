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
import type { PedalRow } from "@/lib/pedals";
import { SESSION_LABELS } from "@/lib/season";
import PedalChart from "./PedalChart";

// How every driver used the throttle and brake over their fastest lap in any session since 2018.
// The analysis runs as soon as a session is chosen (there is nothing else to configure), and the
// pickers only offer races and sessions that actually happened.
export default function PedalAnalysis({ initial }: { initial: RaceParams }) {
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session: initial.session });

  const analysis = useAsync<PedalRow[]>(
    sel.round === null
      ? null
      : () =>
          axios
            .post<{ data: PedalRow[] }>("/api/v1/telemetry/pedal-behavior", { year: sel.year, round: sel.round, session: sel.session })
            .then((res) => res.data.data),
    `pedals-${sel.year}-${sel.round}-${sel.session}`,
  );

  return (
    <>
      <PageHeader
        title="Advanced analytics"
        description="Throttle, brake and coasting behaviour for every driver across a session."
      />
      <Panel title="Choose a session" className="mb-4">
        <div className="p-4">
          <SessionPicker value={sel} onChange={setSel} />
        </div>
      </Panel>

      {analysis.status === "error" ? (
        <ErrorState title="Couldn't run the analysis" message={analysis.message} onRetry={analysis.notFound ? undefined : analysis.retry} />
      ) : analysis.status === "ready" ? (
        <Panel title="Pedal behaviour" meta={`${sel.year}, round ${sel.round}, ${SESSION_LABELS[sel.session]}`}>
          <div className="p-4">
            <PedalChart rows={analysis.data} />
          </div>
        </Panel>
      ) : (
        <Loading label="Analysing the session">
          <p className="mb-4 text-sm text-mute">
            {sel.round === null
              ? "Loading the season's races…"
              : "Analysing every driver's fastest lap. The first time a race is opened this can take up to a minute."}
          </p>
          <Skeleton className="h-96" />
        </Loading>
      )}
    </>
  );
}
