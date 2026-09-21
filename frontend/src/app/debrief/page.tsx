"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import { Newspaper, Timer, Flag, AlertTriangle, Sparkles, TrendingUp, Loader2 } from "lucide-react";
import ErrorState from "@/components/ErrorState";
import StintBar from "@/components/StintBar";
import WhatIfPanel from "@/components/WhatIfPanel";
import CompoundBadge from "@/components/CompoundBadge";
import { getApiErrorMessage } from "@/lib/apiError";
import type { DebriefResponse } from "@/lib/insights";

interface RaceOption {
  country: string;
  event_name: string;
  race_start_utc: string | null;
}

const FIRST_SEASON = 2018; // FastF1 lap-level data starts here

function hasStarted(race: RaceOption): boolean {
  return race.race_start_utc !== null && Date.parse(race.race_start_utc) <= Date.now();
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function parseYear(value: string | null, max: number): number | null {
  const year = value ? parseInt(value, 10) : NaN;
  return Number.isInteger(year) && year >= FIRST_SEASON && year <= max ? year : null;
}

// useSearchParams needs a Suspense boundary so the page can still be prerendered.
export default function DebriefPage() {
  return (
    <Suspense fallback={null}>
      <DebriefContent />
    </Suspense>
  );
}

function DebriefContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();
  // A shared link (?year=2023&race=Belgian Grand Prix) opens that race. It applies only
  // to the season it came with, and is dropped as soon as the user picks a season
  // themselves. Deliberately not "consumed" on first use: effects run twice in dev
  // (StrictMode) and any load may be repeated, so the lookup must be idempotent.
  const linked = useRef({ year: parseYear(searchParams.get("year"), currentYear), race: searchParams.get("race") });
  const [year, setYear] = useState(linked.current.year ?? currentYear);
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [racesLoading, setRacesLoading] = useState(true);
  const [racesError, setRacesError] = useState("");
  const [eventName, setEventName] = useState("");
  const [debrief, setDebrief] = useState<DebriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latestRequest = useRef(0);

  const loadRaces = useCallback(() => {
    setRacesLoading(true);
    setRacesError("");
    setDebrief(null);
    axios
      .get(`/api/v1/races/historical?year=${year}`)
      .then((res) => {
        // Only races that have actually been run can be debriefed; default to the latest.
        const finished: RaceOption[] = res.data.filter(hasStarted);
        setRaces(finished);
        const wanted = year === linked.current.year ? linked.current.race : null;
        const pick = finished.find((r) => r.event_name === wanted) ?? finished[finished.length - 1];
        setEventName(pick ? pick.event_name : "");
      })
      .catch((err) => setRacesError(getApiErrorMessage(err, "Couldn't load the race calendar.")))
      .finally(() => setRacesLoading(false));
  }, [year]);

  useEffect(() => {
    loadRaces();
  }, [loadRaces]);

  const loadDebrief = useCallback(() => {
    if (!eventName) return;
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError("");
    setDebrief(null);
    axios
      .get<DebriefResponse>("/api/v1/debrief", { params: { year, gp: eventName, session: "Race" } })
      .then((res) => {
        if (requestId === latestRequest.current) setDebrief(res.data);
      })
      .catch((err) => {
        if (requestId === latestRequest.current) setError(getApiErrorMessage(err, "Couldn't build the debrief."));
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false);
      });
  }, [year, eventName]);

  useEffect(() => {
    loadDebrief();
  }, [loadDebrief]);

  // Keep the URL in step with the selection so a debrief can be shared or bookmarked.
  useEffect(() => {
    if (!eventName) return;
    router.replace(`/debrief?year=${year}&race=${encodeURIComponent(eventName)}`, { scroll: false });
  }, [year, eventName, router]);

  const facts = debrief?.facts;

  return (
    <div className="w-full py-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div className="border-b border-white/10 pb-6">
        <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
          <Newspaper className="w-8 h-8 text-f1-red" />
          Race Debrief
        </h1>
        <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
          An auto-generated summary of how a race unfolded, built from the official results and lap data
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="debrief-season" className="block text-xs font-titillium font-bold text-white/60 mb-2">SEASON</label>
          <select
            id="debrief-season"
            value={year}
            onChange={(e) => {
              linked.current = { year: null, race: null };
              setYear(parseInt(e.target.value));
            }}
            className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red"
          >
            {Array.from({ length: currentYear - FIRST_SEASON + 1 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="debrief-race" className="block text-xs font-titillium font-bold text-white/60 mb-2">GRAND PRIX</label>
          <select
            id="debrief-race"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            disabled={racesLoading || races.length === 0}
            className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red disabled:opacity-50"
          >
            {racesLoading && <option value="">Loading…</option>}
            {!racesLoading && races.length === 0 && <option value="">No completed races yet</option>}
            {races.map((r) => (
              <option key={r.event_name} value={r.event_name}>{r.country} — {r.event_name}</option>
            ))}
          </select>
        </div>
      </div>

      {racesError ? (
        <ErrorState title="Couldn't load the calendar" message={racesError} onRetry={loadRaces} />
      ) : loading ? (
        <div className="space-y-4" role="status" aria-label="Building debrief">
          <div className="flex items-center gap-3 text-white/50 font-titillium text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-f1-red" />
            Loading session data — the first request for a race can take up to a minute.
          </div>
          <div className="glass-panel p-6 rounded-xl border border-white/5 animate-pulse space-y-3">
            <div className="h-5 w-2/3 bg-white/10 rounded" />
            <div className="h-4 w-full bg-white/5 rounded" />
            <div className="h-4 w-5/6 bg-white/5 rounded" />
            <div className="h-4 w-4/6 bg-white/5 rounded" />
          </div>
        </div>
      ) : error ? (
        <ErrorState title="Couldn't build the debrief" message={error} onRetry={loadDebrief} />
      ) : facts && debrief ? (
        <>
          <section className="glass-panel p-6 rounded-xl border border-white/5" aria-labelledby="summary-heading">
            <h2 id="summary-heading" className="text-xl font-bold text-white font-titillium mb-4">
              {facts.year} {facts.event}
            </h2>
            <div className="space-y-4 text-white/80 font-titillium leading-relaxed">
              {debrief.summary.split("\n\n").map((paragraph, i) => <p key={i}>{paragraph}</p>)}
            </div>
            <p className="text-[11px] text-white/30 font-titillium mt-4 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {debrief.source === "ai"
                ? "Written by AI from the data below"
                : "Auto-generated from the data below"}
            </p>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Podium">
            {facts.podium.map((p) => (
              <div key={p.code} className="glass-panel p-5 rounded-xl border border-white/5">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-black text-white tabular-nums">P{p.position}</span>
                  <span className="text-xs text-white/40 tabular-nums">
                    {p.gap ?? facts.winner.race_time ?? ""}
                  </span>
                </div>
                <div className="text-lg font-bold text-white font-titillium mt-1">{p.name}</div>
                <div className="text-sm text-white/50 font-titillium">{p.team}</div>
                <div className="flex items-center gap-1.5 mt-3 text-xs text-white/60 font-titillium tabular-nums">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Started P{p.grid}
                  {p.positions_gained !== 0 && (
                    <span className={p.positions_gained > 0 ? "text-f1-green" : "text-f1-red"}>
                      ({p.positions_gained > 0 ? "+" : "−"}{Math.abs(p.positions_gained)})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </section>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-label="Key numbers">
            {facts.fastest_lap && (
              <div className="glass-panel p-4 rounded-xl border border-white/5 col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1"><Timer className="w-3 h-3" />Fastest lap</div>
                <div className="text-2xl font-black text-white tabular-nums mt-1">{facts.fastest_lap.time}</div>
                <div className="text-sm text-white/60 font-titillium flex items-center gap-2 mt-0.5">
                  {facts.fastest_lap.name} · lap {facts.fastest_lap.lap}
                  {facts.fastest_lap.compound && <CompoundBadge compound={facts.fastest_lap.compound} />}
                </div>
              </div>
            )}
            <div className="glass-panel p-4 rounded-xl border border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1"><Flag className="w-3 h-3" />Neutralisations</div>
              <div className="text-sm text-white/80 font-titillium mt-2 space-y-0.5 tabular-nums">
                <div>{plural(facts.neutralisations.safety_cars, "safety car")}</div>
                <div>{plural(facts.neutralisations.virtual_safety_cars, "virtual SC")}</div>
                <div>{plural(facts.neutralisations.red_flags, "red flag")}</div>
              </div>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Retirements</div>
              {facts.retirements.length === 0 ? (
                <div className="text-sm text-white/50 font-titillium mt-2">None</div>
              ) : (
                <ul className="text-sm text-white/80 font-titillium mt-2 space-y-0.5">
                  {facts.retirements.map((r) => (
                    <li key={r.code} title={`${r.name} (${r.team})`}>
                      {r.code}
                      <span className="text-white/40 tabular-nums">
                        {r.laps_completed === null ? "" : r.laps_completed === 0 ? " · lap 1" : ` · after ${r.laps_completed}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {facts.strategies.length > 0 && (
            <section className="glass-panel p-6 rounded-xl border border-white/5" aria-labelledby="strategy-heading">
              <h2 id="strategy-heading" className="text-lg font-bold text-white uppercase font-titillium mb-4">Tyre strategies (top {facts.strategies.length})</h2>
              <div className="space-y-3">
                {facts.strategies.map((s) => (
                  <div key={s.code} className="flex items-center gap-3">
                    <span className="w-10 text-sm font-bold text-white font-titillium">{s.code}</span>
                    <div className="flex-1"><StintBar stints={s.stints} /></div>
                    <span className="w-16 text-right text-xs text-white/40 font-titillium tabular-nums">{plural(s.stops, "stop")}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <WhatIfPanel facts={facts} />
        </>
      ) : null}
    </div>
  );
}
