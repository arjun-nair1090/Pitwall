"use client";

import axios from "axios";
import { Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { LIVE_REFRESH_MS } from "@/components/AppInitializer";
import CompoundBadge from "@/components/CompoundBadge";
import EmptyState from "@/components/ui/EmptyState";
import Pill from "@/components/ui/Pill";
import { VERDICT_LABEL, type Verdict } from "@/lib/pitwindow";
import {
  battleWhen,
  closingText,
  marginText,
  neighbourText,
  PIT_LOSS_SOURCE,
  rejoinText,
  windowText,
  type CutOdds,
  type RaceStrategy,
} from "@/lib/raceStrategy";
import { useF1Store } from "@/store/useTelemetryStore";

const VERDICT_CLASS: Record<Verdict, string> = {
  likely: "text-timing-green",
  possible: "text-timing-yellow",
  unlikely: "text-mute",
};

const HEADING = "mb-2 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-mute";

function Odds({ label, odds }: { label: string; odds: CutOdds | null }) {
  if (!odds) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {label} onto <CompoundBadge compound={odds.compound} />
      <span className={`font-semibold ${VERDICT_CLASS[odds.verdict]}`}>{VERDICT_LABEL[odds.verdict]}</span>
      <span className="tabular-nums text-faint">{marginText(odds)}</span>
    </span>
  );
}

// During a race: battles about to start, where each car would come out if it stopped now, and the
// undercut and overcut odds between close cars, refreshed with the timing.
export default function RaceStrategyPanel() {
  const sessionKey = useF1Store((s) => s.activeSession?.session_key);
  const live = useF1Store((s) => s.activeSession?.live === true);
  const [data, setData] = useState<RaceStrategy | null>(null);

  useEffect(() => {
    setData(null);
    if (!sessionKey || !live) return;
    let cancelled = false;
    const load = () =>
      axios
        .get<RaceStrategy>(`/api/v1/sessions/${sessionKey}/race-strategy`)
        .then((res) => !cancelled && setData(res.data))
        .catch((err) => console.error("Failed to load the race strategy", err));
    load();
    const timer = setInterval(load, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionKey, live]);

  if (!live || (data && !data.live)) {
    return (
      <EmptyState icon={Swords} title="No race is live" description="Battles, pit stops and undercuts appear here during a race." className="h-full" />
    );
  }
  if (!data) return <EmptyState icon={Swords} title="Loading the race strategy" className="h-full" />;
  if (!data.applicable) {
    return (
      <EmptyState
        icon={Swords}
        title={`Nothing to forecast in ${data.session_name || "this session"}`}
        description="Battles, pit stops and undercuts are forecast in races and sprints."
        className="h-full"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 text-sm text-chalk">
      {data.neutralised && (
        <p role="status" className="rounded-control border border-timing-yellow/60 px-3 py-2 text-timing-yellow">
          Safety car or VSC: no battles are forecast, and a stop now costs about half.
        </p>
      )}

      <section aria-labelledby="battles-heading">
        <h3 id="battles-heading" className={HEADING}>Battles</h3>
        {data.battles.length === 0 ? (
          <p className="text-mute">No car is in DRS range or set to reach it in the next laps.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.battles.map((b) => (
              <li key={`${b.behind.number}-${b.ahead.number}`} className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold">{b.behind.code} on {b.ahead.code}</span>
                <span className="tabular-nums">{b.gap.toFixed(1)} s</span>
                <Pill tone={b.in_drs ? "live" : "yellow"}>{battleWhen(b)}</Pill>
                <span className="tabular-nums text-faint">{closingText(b)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rejoin-heading">
        <h3 id="rejoin-heading" className={HEADING}>If they pit now</h3>
        <p className="mb-2 text-xs text-faint">
          Pit loss {data.pit_loss.toFixed(1)} s, {PIT_LOSS_SOURCE[data.pit_loss_source]}. Places are after the out-lap.
        </p>
        <ul className="flex flex-col gap-1.5">
          {data.pit_stops.map((s) => {
            const plan = windowText(s);
            return (
              <li key={s.number} className="flex flex-wrap items-center gap-x-2">
                <span className="w-9 tabular-nums text-faint">P{s.position}</span>
                <span className="font-semibold">{s.code}</span>
                <span>→ {rejoinText(s)}</span>
                <span className="tabular-nums text-faint">{neighbourText(s)}</span>
                {s.traffic && <Pill tone="yellow">Traffic</Pill>}
                {plan && <span className="text-mute">{plan}{s.early ? " (early estimate)" : ""}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="duels-heading">
        <h3 id="duels-heading" className={HEADING}>Undercut and overcut</h3>
        {data.pit_duels.length === 0 ? (
          <p className="text-mute">No car close enough to the one ahead, or too few laps yet to read the tyres.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.pit_duels.map((d) => (
              <li key={`${d.chaser.number}-${d.leader.number}`} className="flex flex-col gap-0.5">
                <span>
                  <span className="font-semibold">{d.chaser.code} on {d.leader.code}</span>{" "}
                  <span className="tabular-nums text-faint">{d.gap.toFixed(1)} s</span>
                </span>
                <span className="flex flex-wrap gap-x-4">
                  <Odds label="Undercut" odds={d.undercut} />
                  <Odds label="Overcut" odds={d.overcut} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
