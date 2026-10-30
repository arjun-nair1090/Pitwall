"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SessionPicker, { type RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import LapStepper from "@/components/ui/LapStepper";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import type { RaceParams } from "@/lib/compareParams";
import { DEFAULT_LAP, defaultLap, lastLapFromError, type PitWindowResult } from "@/lib/pitwindow";
import { SESSION_LABELS } from "@/lib/season";
import PitTable from "./PitTable";
import TyreModel from "./TyreModel";
import UndercutList from "./UndercutList";

const SESSIONS = ["R", "S"] as const;

const CAVEAT =
  "Worked out from only the laps run so far, as the pit wall would have seen it. Traffic, tyre warm-up and weather changes aren't modelled.";
const IN_LAP_NOTE = "A car that pits at the end of this lap still shows the tyres it came in on.";

const linkFor = (sel: RaceSelection, lap: number) => `/pitwindow?year=${sel.year}&round=${sel.round}&session=${sel.session}&lap=${lap}`;

// Replays any lap of a past race: what each driver should do about the next stop, from only the laps
// run so far.
export default function PitWindowPage({ initial }: { initial: RaceParams & { lap?: number | null } }) {
  const router = useRouter();
  // A link from another page may name qualifying or practice; use the race instead of asking the
  // server for a session it refuses.
  const session = initial.session === "S" ? "S" : "R";
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session });
  // Null until the lap is chosen: a link names one, otherwise it is picked once the race length is known.
  const [lap, setLap] = useState<number | null>(initial.lap ?? null);
  const [total, setTotal] = useState<number | null>(null);
  const requestLap = lap ?? DEFAULT_LAP;

  const analysis = useAsync<PitWindowResult>(
    sel.round === null
      ? null
      : () =>
          axios
            .post<PitWindowResult>("/api/v1/telemetry/pit-window", { year: sel.year, round: sel.round, session: sel.session, lap: requestLap })
            .then((res) => res.data),
    `pit-${sel.year}-${sel.round}-${sel.session}-${requestLap}`,
  );

  const data = analysis.status === "ready" ? analysis.data : null;
  const errorMessage = analysis.status === "error" ? analysis.message : null;

  // Once the race length is known: remember it, pick the lap if nobody has, and pull a lap past the
  // end back to the last one the server takes.
  useEffect(() => {
    if (!data) return;
    setTotal(data.total_laps);
    const last = Math.max(1, data.total_laps - 1);
    setLap((current) => (current === null ? defaultLap(data.total_laps) : Math.min(current, last)));
  }, [data]);

  // The server names the last lap it will take when the lap was too far on: a linked lap past the
  // end, or the first request in a very short race. Its "Pick a lap from 1 to N." wording is a
  // contract with the backend, which pins it in a test.
  useEffect(() => {
    const last = errorMessage === null ? null : lastLapFromError(errorMessage);
    if (last === null) return;
    setTotal(last + 1);
    setLap((current) => (current === null ? Math.min(DEFAULT_LAP, last) : Math.min(current, last)));
  }, [errorMessage]);

  const lastLink = useRef(sel.round === null || initial.lap == null ? null : linkFor(sel, initial.lap));
  useEffect(() => {
    if (sel.round === null || lap === null) return;
    const link = linkFor(sel, lap);
    if (link === lastLink.current) return;
    lastLink.current = link;
    router.replace(link, { scroll: false });
  }, [router, sel, lap]);

  const choose = (next: RaceSelection) => {
    setSel(next);
    setLap(null);
    setTotal(null);
  };

  // A bad lap stays on screen with its message, and the stepper stays usable to pick another.
  const noRound = sel.round === null;

  return (
    <>
      <PageHeader
        title="Pit window"
        description="Replay any lap of a past race: each driver's best pit plan, when their window opens, and who could undercut."
      />
      <Panel title="Choose a session" className="mb-4">
        <div className="p-4">
          <SessionPicker value={sel} onChange={choose} allowedSessions={SESSIONS} />
        </div>
      </Panel>
      {!noRound && (
        <Panel title="Lap" className="mb-4">
          <div className="p-4">
            <LapStepper lap={requestLap} total={total} onChange={setLap} />
          </div>
        </Panel>
      )}

      {analysis.status === "error" ? (
        <ErrorState title="Couldn't run the analysis" message={analysis.message} onRetry={analysis.notFound || lastLapFromError(analysis.message) !== null ? undefined : analysis.retry} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <Panel title="Pit plans" meta={`${sel.year}, round ${sel.round}, ${SESSION_LABELS[sel.session]}, lap ${data.lap}`}>
            <div className="p-4">
              <PitTable drivers={data.drivers} />
              <p className="mt-3 text-xs text-faint">{IN_LAP_NOTE}</p>
            </div>
          </Panel>
          <Panel title="Undercut threats">
            <div className="p-4">
              <UndercutList undercuts={data.undercuts} />
            </div>
          </Panel>
          <Panel title="Tyre model">
            <div className="p-4">
              <TyreModel model={data.model} pitLoss={data.pit_loss} />
              <p className="mt-3 text-xs text-faint">{CAVEAT}</p>
            </div>
          </Panel>
        </div>
      ) : (
        <Loading
          label="Working out the pit windows"
          message={sel.round === null
            ? "Loading the season's races…"
            : "Reading every lap run so far. The first time a race is opened this can take up to a minute."}
        >
          <Skeleton className="h-96" />
        </Loading>
      )}
    </>
  );
}
