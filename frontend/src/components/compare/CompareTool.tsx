"use client";

import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import SessionPicker, { type RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import Panel from "@/components/ui/Panel";
import PageHeader from "@/components/ui/PageHeader";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import { useSessionInfo } from "@/hooks/useRaceData";
import { buildDuelRows, duelStyle, type DuelResult } from "@/lib/duel";
import type { RaceParams } from "@/lib/compareParams";
import DominanceMap from "./DominanceMap";
import DuelCharts from "./DuelCharts";
import DuelHeader from "./DuelHeader";
import DuelPicker, { type DuelChoice } from "./DuelPicker";

interface CompareBody {
  year: number;
  round: number;
  session: string;
  driver1: string;
  driver2: string;
  driver1_lap?: number;
  driver2_lap?: number;
}

const requestBody = (sel: { year: number; round: number; session: string }, c: DuelChoice): CompareBody => ({
  year: sel.year,
  round: sel.round,
  session: sel.session,
  driver1: c.d1,
  driver2: c.d2,
  ...(c.l1 && { driver1_lap: Number(c.l1) }),
  ...(c.l2 && { driver2_lap: Number(c.l2) }),
});

const NO_CHOICE: DuelChoice = { d1: "", l1: "", d2: "", l2: "" };
const sameChoice = (a: DuelChoice, b: DuelChoice) => a.d1 === b.d1 && a.l1 === b.l1 && a.d2 === b.d2 && a.l2 === b.l2;

// Two laps side by side: pick a race and session, two drivers (and optionally which lap of each),
// and see where the time was won. The top two finishers are compared straight away so the page
// is never empty; after that a change waits for the button, because each new comparison loads a
// full session of telemetry.
export default function CompareTool({ initial }: { initial: RaceParams }) {
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session: initial.session });
  const [choice, setChoice] = useState<DuelChoice>(NO_CHOICE);
  const [submitted, setSubmitted] = useState<{ body: CompareBody; choice: DuelChoice } | null>(null);
  const linked = useRef({ d1: initial.d1, d2: initial.d2 });

  const info = useSessionInfo(sel.year, sel.round, sel.session);
  const session = info.status === "ready" ? info.data : null;

  // Each time a session's drivers arrive, start from the linked drivers if they took part,
  // otherwise the top two, and compare them.
  useEffect(() => {
    if (!session || sel.round === null) {
      setSubmitted(null);
      return;
    }
    const codes = new Set(session.drivers.map((d) => d.code));
    const { d1: linkA, d2: linkB } = linked.current;
    linked.current = { d1: null, d2: null }; // the link only applies to the first session shown
    const useLink = linkA && linkB && linkA !== linkB && codes.has(linkA) && codes.has(linkB);
    const [first, second] = session.drivers;
    const start: DuelChoice = useLink
      ? { d1: linkA, l1: "", d2: linkB, l2: "" }
      : { d1: first?.code ?? "", l1: "", d2: second?.code ?? first?.code ?? "", l2: "" };
    setChoice(start);
    if (start.d1 && start.d2) setSubmitted({ body: requestBody({ ...sel, round: sel.round }, start), choice: start });
    // sel changes only matter through `session`, which is keyed on it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const duel = useAsync<DuelResult>(
    submitted ? () => axios.post<DuelResult>("/api/v1/telemetry/compare", submitted.body).then((res) => res.data) : null,
    JSON.stringify(submitted?.body ?? null),
  );

  const dirty = submitted !== null && !sameChoice(choice, submitted.choice);
  const submit = () => {
    if (sel.round === null) return;
    setSubmitted({ body: requestBody({ ...sel, round: sel.round }, choice), choice });
  };

  const result = duel.status === "ready" ? duel.data : null;
  const style = useMemo(() => (result ? duelStyle(result.driver1.color, result.driver2.color) : null), [result]);
  const rows = useMemo(() => (result ? buildDuelRows(result.driver1.telemetry, result.driver2.telemetry) : []), [result]);

  return (
    <>
      <PageHeader title="Head to head" description="Overlay two laps and see exactly where the time was won." />

      <Panel title="Choose the laps" className="mb-4">
        <div className="flex flex-col gap-4 p-4">
          <SessionPicker value={sel} onChange={setSel} />
          <DuelPicker
            drivers={session?.drivers ?? []}
            value={choice}
            onChange={setChoice}
            onSubmit={submit}
            loading={duel.status === "loading"}
            dirty={dirty}
          />
        </div>
      </Panel>

      {info.status === "error" ? (
        <ErrorState
          title="Couldn't load this session"
          message={info.message}
          onRetry={info.notFound ? undefined : info.retry}
        />
      ) : duel.status === "error" ? (
        <ErrorState
          title="Couldn't compare these laps"
          message={duel.message}
          onRetry={duel.notFound ? undefined : duel.retry}
        />
      ) : duel.status === "loading" ? (
        <Loading label="Loading telemetry">
          <p className="mb-4 text-sm text-mute">
            Loading the telemetry for {submitted?.choice.d1} and {submitted?.choice.d2}. The first time a race is opened this can take up to a minute.
          </p>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        </Loading>
      ) : result && style && session ? (
        <div className="flex flex-col gap-4">
          <DuelHeader driver1={result.driver1} driver2={result.driver2} style={style} year={sel.year} eventName={session.event_name} session={sel.session} />
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Panel title="Where the time was won" meta={`${session.event_name} ${sel.year}`} className="xl:sticky xl:top-20">
              <div className="p-4">
                <DominanceMap lap1={result.driver1.telemetry} lap2={result.driver2.telemetry} code1={result.driver1.code} code2={result.driver2.code} style={style} />
              </div>
            </Panel>
            <Panel title="Telemetry" meta="Both laps, by distance round the lap">
              <div className="p-4">
                <DuelCharts rows={rows} code1={result.driver1.code} code2={result.driver2.code} style={style} />
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </>
  );
}
