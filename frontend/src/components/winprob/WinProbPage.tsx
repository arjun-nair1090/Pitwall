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
import { lastLapFromError } from "@/lib/pitwindow";
import { SESSION_LABELS } from "@/lib/season";
import { clampLap, type WinProbResult } from "@/lib/winprob";
import LapOdds from "./LapOdds";
import WinChart from "./WinChart";

const SESSIONS = ["R", "S"] as const;

const CAVEAT =
  "Each lap is worked out only from the laps run so far: every driver's best remaining strategy, plus thousands of simulated finishes with random pace, retirements and a possible safety car. It predicts who crosses the line first, so a later penalty or disqualification isn't known to it.";

const linkFor = (sel: RaceSelection, lap: number) => `/winprob?year=${sel.year}&round=${sel.round}&session=${sel.session}&lap=${lap}`;

// Replays a race lap by lap: each driver's chance of winning, and the table behind any lap.
export default function WinProbPage({ initial }: { initial: RaceParams & { lap?: number | null } }) {
  const router = useRouter();
  // A link from another page may name qualifying or practice; use the race instead of asking the
  // server for a session it refuses.
  const session = initial.session === "S" ? "S" : "R";
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session });
  // Null until a lap is chosen or linked: the first request then omits it and the server picks the middle.
  const [lap, setLap] = useState<number | null>(initial.lap ?? null);
  const [total, setTotal] = useState<number | null>(null);

  const analysis = useAsync<WinProbResult>(
    sel.round === null
      ? null
      : () =>
          axios
            .post<WinProbResult>("/api/v1/telemetry/win-probability", {
              year: sel.year,
              round: sel.round,
              session: sel.session,
              ...(lap === null ? {} : { lap }),
            })
            .then((res) => res.data),
    `win-${sel.year}-${sel.round}-${sel.session}-${lap ?? "auto"}`,
  );

  const data = analysis.status === "ready" ? analysis.data : null;
  const errorMessage = analysis.status === "error" ? analysis.message : null;

  // The race length arrives with the answer; a chosen lap past the end is pulled back to the last.
  useEffect(() => {
    if (!data) return;
    setTotal(data.total_laps);
    setLap((current) => (current === null ? null : clampLap(current, data.total_laps)));
  }, [data]);

  // A linked lap past the end is refused with the last lap the server takes. The "Pick a lap from 1
  // to N." wording is a contract with the backend.
  useEffect(() => {
    const last = errorMessage === null ? null : lastLapFromError(errorMessage);
    if (last === null) return;
    setTotal(last);
    setLap((current) => (current === null ? null : clampLap(current, last)));
  }, [errorMessage]);

  const shownLap = lap ?? data?.at.lap ?? 1;

  const linkLap = lap ?? data?.at.lap ?? null;
  const lastLink = useRef(sel.round === null || initial.lap == null ? null : linkFor(sel, initial.lap));
  useEffect(() => {
    if (sel.round === null || linkLap === null) return;
    const link = linkFor(sel, linkLap);
    if (link === lastLink.current) return;
    lastLink.current = link;
    router.replace(link, { scroll: false });
  }, [router, sel, linkLap]);

  const choose = (next: RaceSelection) => {
    setSel(next);
    setLap(null);
    setTotal(null);
  };

  const noRound = sel.round === null;
  // A refusal says what is wrong with the request; asking again would get the same answer.
  const refused = analysis.status === "error" && (analysis.notFound || analysis.httpStatus === 422);

  return (
    <>
      <PageHeader
        title="Win probability"
        description="Replay any race or sprint lap by lap: every driver's chance of winning, and the table behind any lap."
      />
      <Panel title="Choose a session" className="mb-4">
        <div className="p-4">
          <SessionPicker value={sel} onChange={choose} allowedSessions={SESSIONS} />
        </div>
      </Panel>
      {!noRound && (
        <Panel title="Lap" className="mb-4">
          <div className="p-4">
            <LapStepper lap={shownLap} total={total} includeLast onChange={setLap} />
          </div>
        </Panel>
      )}

      {analysis.status === "error" ? (
        <ErrorState title="Couldn't run the analysis" message={analysis.message} onRetry={refused ? undefined : analysis.retry} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <Panel title="Chance of winning" meta={`${sel.year}, round ${sel.round}, ${SESSION_LABELS[sel.session]}`}>
            <div className="p-4">
              <WinChart data={data} lap={data.at.lap} onSelect={setLap} />
              <p className="mt-3 text-xs text-faint">{CAVEAT}</p>
            </div>
          </Panel>
          <Panel title="The field at this lap" meta={`As of lap ${data.at.lap}`}>
            <div className="p-4">
              <LapOdds rows={data.at.rows} drivers={data.drivers} />
            </div>
          </Panel>
        </div>
      ) : (
        <Loading label="Working out every lap">
          <p className="mb-4 text-sm text-mute">
            {noRound
              ? "Loading the season's races…"
              : "Working out every lap of the race… The first time a race is opened this can take up to a minute."}
          </p>
          <Skeleton className="h-96" />
        </Loading>
      )}
    </>
  );
}
