"use client";

import axios from "axios";
import { useState } from "react";
import type { RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import { useSessionInfo } from "@/hooks/useRaceData";
import { isLevel, type CornerConsistencyResult, type CornerConsistencyRow } from "@/lib/corners";
import { formatLapTime } from "@/lib/timing";
import CornerHeatmap from "./CornerHeatmap";

// Races and sprints, where the car changes from lap to lap.
const RACE_SESSIONS = new Set(["R", "S"]);

// A single lap's braking point has no spread to show, so the ± only appears once two laps braked.
function brakingPoint(c: CornerConsistencyRow): string {
  if (!c.brake_before_m) return "No braking";
  const braked = c.per_lap.filter((p) => p.brake_before_m !== null).length;
  const mean = Math.round(c.brake_before_m.mean);
  return braked >= 2 ? `${mean} ± ${Math.round(c.brake_before_m.sd)} m` : `${mean} m`;
}

const columns: Column<CornerConsistencyRow>[] = [
  { key: "turn", header: "Turn", cell: (c) => <span className="font-semibold">{c.label}</span> },
  { key: "spread", header: "Spread", align: "right", className: "whitespace-nowrap", cell: (c) => `${c.zone_time.sd.toFixed(3)} s` },
  { key: "min", header: "Min speed", align: "right", className: "whitespace-nowrap", cell: (c) => `${Math.round(c.apex_speed.mean)} ± ${c.apex_speed.sd.toFixed(1)} km/h` },
  { key: "braking", header: "Braking point", align: "right", className: "whitespace-nowrap", cell: brakingPoint },
];

// How repeatable one driver was through each corner over their clean laps, and the lap they could
// have done by stringing their best corners together.
export default function CornerConsistency({ sel }: { sel: RaceSelection }) {
  const info = useSessionInfo(sel.year, sel.round, sel.session);
  // For one render after the session changes the info still describes the previous one; asking for
  // its driver then would start a second, wasted analysis.
  const current = info.status === "ready" && info.data.year === sel.year && info.data.round === sel.round && info.data.session === sel.session;
  const drivers = current ? info.data.drivers : [];
  const [picked, setPicked] = useState<string | null>(null);
  // Keep the chosen driver across sessions they took part in, otherwise start from the first
  const driver = drivers.some((d) => d.code === picked) ? picked : drivers[0]?.code ?? null;

  const analysis = useAsync<CornerConsistencyResult>(
    sel.round === null || driver === null
      ? null
      : () =>
          axios
            .post<CornerConsistencyResult>("/api/v1/telemetry/corner-consistency", { year: sel.year, round: sel.round, session: sel.session, driver })
            .then((res) => res.data),
    `consistency-${sel.year}-${sel.round}-${sel.session}-${driver}`,
  );
  const result = analysis.status === "ready" ? analysis.data : null;

  return (
    <Panel
      title="Corner consistency"
      meta={result && result.corners.length > 0 ? `${result.driver.name}, ${result.laps.length} clean laps` : undefined}
    >
      <div className="p-4">
        <Select
          label="Driver"
          className="mb-4 max-w-xs"
          value={driver ?? ""}
          disabled={drivers.length === 0}
          onChange={(e) => setPicked(e.target.value)}
        >
          {drivers.map((d) => <option key={d.code} value={d.code}>{d.code} {d.name}</option>)}
        </Select>

        {info.status === "error" ? (
          <ErrorState title="Couldn't load the drivers" message={info.message} onRetry={info.notFound ? undefined : info.retry} />
        ) : analysis.status === "error" ? (
          <ErrorState title="Couldn't judge consistency" message={analysis.message} onRetry={analysis.notFound ? undefined : analysis.retry} />
        ) : result && result.corners.length === 0 ? (
          <EmptyState title="Corner data isn't available for this session" />
        ) : result ? (
          <>
            <p className="text-sm text-chalk">
              {`Ideal lap from best corners: ${formatLapTime(result.ideal_lap)}, ${
                isLevel(result.best_lap - result.ideal_lap)
                  ? "the same as the best lap"
                  : `${(result.best_lap - result.ideal_lap).toFixed(3)} s quicker than the best lap`
              }`}
            </p>
            {RACE_SESSIONS.has(sel.session) && (
              <p className="mt-1 text-xs text-faint">Fuel, tyres and traffic change through a race, so this is a ceiling rather than a target.</p>
            )}
            <div className="mt-4">
              <CornerHeatmap laps={result.laps} corners={result.corners} />
            </div>
            <p className="mt-6 text-xs text-faint">
              Spread is how much the time through a corner varied from lap to lap (one standard deviation). The figures after ± are the same measure.
            </p>
            <DataTable
              columns={columns}
              rows={[...result.corners].sort((a, b) => b.zone_time.sd - a.zone_time.sd)}
              rowKey={(c) => c.label}
              caption="Corners ranked by spread, the least consistent first"
              dense
              className="mt-2"
            />
          </>
        ) : (
          <Loading
            label="Analysing the laps"
            message={driver === null
              ? "Loading the session's drivers…"
              : "Analysing every clean lap. The first time a race is opened this can take up to a minute."}
          >
            <Skeleton className="h-72" />
          </Loading>
        )}
      </div>
    </Panel>
  );
}

