"use client";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import SessionPicker, { type RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import { useSessionInfo } from "@/hooks/useRaceData";
import type { RaceParams } from "@/lib/compareParams";
import { driverStrategy, planStatus, presetPlan, strategyIssue, type SimulationResult, type Stint } from "@/lib/strategy";
import LapBudget from "./LapBudget";
import StintEditor from "./StintEditor";
import StrategyResult from "./StrategyResult";

interface Submitted {
  plan: Stint[];
  driver: string;
}

interface Outcome {
  result: SimulationResult;
  baseline: SimulationResult | null;
}

const RACE_ONLY = ["R"] as const;
const sameSubmission = (a: Submitted, b: Submitted) => a.driver === b.driver && JSON.stringify(a.plan) === JSON.stringify(b.plan);

// Build a tyre strategy for a real race and see how it would have gone, using that race's own tyre
// wear. The race distance is always in view, the plan can't outgrow it, and a driver's real
// strategy can be loaded, compared against, or both.
export default function StrategyTool({ initial }: { initial: RaceParams }) {
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session: "R" });
  const [plan, setPlan] = useState<Stint[]>([{ compound: "MEDIUM", laps: 1 }]);
  const [driver, setDriver] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  const info = useSessionInfo(sel.year, sel.round, "R");
  const race = info.status === "ready" ? info.data : null;
  const raceLaps = race?.total_laps ?? null;

  // A new race starts from a one-stop plan, already simulated, so the page is never empty.
  useEffect(() => {
    if (!race) {
      setSubmitted(null);
      return;
    }
    const start = presetPlan(1, race.total_laps);
    setPlan(start);
    setDriver("");
    setSubmitted({ plan: start, driver: "" });
  }, [race]);

  const chosen = race?.drivers.find((d) => d.code === driver) ?? null;
  const realPlan = chosen && raceLaps !== null ? driverStrategy(chosen, raceLaps) : null;

  const outcome = useAsync<Outcome>(
    submitted && sel.round !== null
      ? async () => {
          const body = { year: sel.year, round: sel.round, session: "Race" };
          const baselinePlan = submitted.driver && race ? driverStrategy(race.drivers.find((d) => d.code === submitted.driver)!, race.total_laps) : null;
          const [main, base] = await Promise.all([
            axios.post<SimulationResult>("/api/v1/strategy/simulate", { ...body, stints: submitted.plan, ...(submitted.driver && { driver_code: submitted.driver }) }),
            baselinePlan ? axios.post<SimulationResult>("/api/v1/strategy/simulate", { ...body, stints: baselinePlan }) : Promise.resolve(null),
          ]);
          return { result: main.data, baseline: base ? base.data : null };
        }
      : null,
    JSON.stringify(submitted),
  );

  const status = planStatus(plan, raceLaps);
  const dirty = submitted !== null && !sameSubmission(submitted, { plan, driver });
  const driverName = useMemo(() => (chosen ? { code: chosen.code, name: chosen.name } : null), [chosen]);
  const shownDriver = submitted?.driver ? race?.drivers.find((d) => d.code === submitted.driver) ?? null : null;

  return (
    <>
      <PageHeader
        title="Strategy simulator"
        description="Build a tyre strategy for a real race and see how it would have gone, using that race's own tyre wear."
      />

      <Panel title="Choose the race" className="mb-4">
        <div className="flex flex-col gap-4 p-4">
          <SessionPicker value={sel} onChange={setSel} showSession={false} allowedSessions={RACE_ONLY} />
          <Select
            label="Compare with a driver's real race"
            value={driver}
            disabled={!race}
            onChange={(e) => setDriver(e.target.value)}
            className="sm:max-w-md"
          >
            <option value="">No comparison</option>
            {race?.drivers.map((d) => {
              const issue = raceLaps !== null ? strategyIssue(d, raceLaps) : null;
              return (
                <option key={d.code} value={d.code} disabled={issue !== null}>
                  {d.code} {d.name}{issue ? ` (${issue})` : ""}
                </option>
              );
            })}
          </Select>
        </div>
      </Panel>

      {info.status === "error" ? (
        <ErrorState title="Couldn't load this race" message={info.message} onRetry={info.notFound ? undefined : info.retry} />
      ) : (
        <>
          <Panel title="Your strategy" className="mb-4">
            <div className="flex flex-col gap-5 p-4">
              <LapBudget stints={plan} raceLaps={raceLaps} />
              <StintEditor stints={plan} raceLaps={raceLaps} onChange={setPlan} />
              <div className="flex flex-wrap items-center gap-3 border-t border-gantry pt-4">
                <Button
                  variant="primary"
                  loading={outcome.status === "loading"}
                  disabled={status.kind !== "complete" || sel.round === null}
                  onClick={() => setSubmitted({ plan, driver })}
                >
                  <FlaskConical aria-hidden className="h-4 w-4" />
                  {dirty ? "Update simulation" : "Run simulation"}
                </Button>
                {realPlan && driverName && (
                  <Button variant="secondary" onClick={() => setPlan(realPlan)}>
                    Use {driverName.code}'s strategy
                  </Button>
                )}
                {status.kind !== "complete" && status.kind !== "unknown" && (
                  <p className="text-sm text-mute">Cover every lap to run the simulation.</p>
                )}
              </div>
            </div>
          </Panel>

          {outcome.status === "error" ? (
            <ErrorState title="Couldn't run the simulation" message={outcome.message} onRetry={outcome.notFound ? undefined : outcome.retry} />
          ) : outcome.status === "loading" ? (
            <Loading label="Simulating">
              <p className="mb-4 text-sm text-mute">Simulating your plan. The first time a race is used this can take up to a minute.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            </Loading>
          ) : outcome.status === "ready" ? (
            <StrategyResult
              result={outcome.data.result}
              baseline={outcome.data.baseline}
              driver={shownDriver ? { code: shownDriver.code, name: shownDriver.name } : null}
            />
          ) : null}
        </>
      )}
    </>
  );
}
