"use client";

import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FlaskConical, Loader2, Sparkles, Info } from "lucide-react";
import StintBar from "@/components/StintBar";
import { getApiErrorMessage } from "@/lib/apiError";
import type { DebriefFacts, Stint, WhatIfChange, WhatIfResponse } from "@/lib/insights";

const COMPOUNDS = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

// Mirrors the server's apply_changes for stop shifts so the form can preview the
// new pit laps and reject impossible plans before making a request. The server
// re-validates everything; this is only for immediate feedback.
function previewShifts(stints: Stint[], shifts: number[]): { stints: Stint[]; error: string | null } {
  const next = stints.map((s) => ({ ...s }));
  for (let i = 0; i < shifts.length; i++) {
    const shift = shifts[i];
    if (!shift) continue;
    next[i].laps += shift;
    next[i + 1].laps -= shift;
    if (next[i].laps < 1 || next[i + 1].laps < 1) {
      return { stints: next, error: `Moving stop ${i + 1} by ${shift > 0 ? "+" : ""}${shift} laps would leave a stint with no laps.` };
    }
  }
  return { stints: next, error: null };
}

function pitLaps(stints: Stint[]): number[] {
  let total = 0;
  return stints.slice(0, -1).map((s) => (total += s.laps));
}

function formatDelta(seconds: number): string {
  if (Math.abs(seconds) < 0.05) return "±0.0";
  return `${seconds > 0 ? "+" : "−"}${Math.abs(seconds).toFixed(1)}`;
}

interface WhatIfPanelProps {
  facts: DebriefFacts;
}

export default function WhatIfPanel({ facts }: WhatIfPanelProps) {
  const drivers = facts.strategies;
  const nameFor = useMemo(() => {
    const names: Record<string, string> = {};
    facts.podium.forEach((p) => (names[p.code] = p.name));
    facts.biggest_gainers.forEach((g) => (names[g.code] = g.name));
    facts.retirements.forEach((r) => (names[r.code] = r.name));
    if (facts.fastest_lap) names[facts.fastest_lap.code] = facts.fastest_lap.name;
    return names;
  }, [facts]);

  const [driver, setDriver] = useState(drivers[0]?.code || "");
  const strategy = drivers.find((d) => d.code === driver);
  const actual = strategy?.stints ?? [];

  const [shifts, setShifts] = useState<number[]>([]);
  const [compounds, setCompounds] = useState<string[]>([]);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // A new debrief or a different driver starts from that driver's real strategy.
  useEffect(() => {
    setDriver(drivers[0]?.code || "");
  }, [facts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setShifts(actual.slice(0, -1).map(() => 0));
    setCompounds(actual.map((s) => s.compound));
    setResult(null);
    setError("");
  }, [driver, facts]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => previewShifts(actual, shifts), [actual, shifts]);

  const changes: WhatIfChange[] = useMemo(() => {
    const list: WhatIfChange[] = [];
    shifts.forEach((laps, i) => laps !== 0 && list.push({ type: "shift_stop", stop: i + 1, laps }));
    compounds.forEach((compound, i) => compound !== actual[i]?.compound && list.push({ type: "change_compound", stint: i + 1, compound }));
    return list;
  }, [shifts, compounds, actual]);

  const previewStints = preview.stints.map((s, i) => ({ ...s, compound: compounds[i] ?? s.compound }));
  const canRun = !loading && changes.length > 0 && !preview.error && actual.length > 0;

  const run = async () => {
    if (!canRun) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await axios.post<WhatIfResponse>("/api/v1/whatif", {
        year: facts.year,
        gp: facts.event,
        session: facts.session,
        driver_code: driver,
        changes,
      });
      setResult(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "The what-if couldn't be evaluated."));
    } finally {
      setLoading(false);
    }
  };

  if (drivers.length === 0) return null;

  return (
    <section className="glass-panel p-6 rounded-xl border border-white/5 space-y-5" aria-labelledby="whatif-heading">
      <div>
        <h2 id="whatif-heading" className="text-lg font-bold text-white uppercase font-titillium flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-f1-red" />
          What if…?
        </h2>
        <p className="text-white/50 text-sm font-titillium mt-1">
          Change a real driver&apos;s strategy and see what the tyre-degradation model says it would have done to their race time.
        </p>
      </div>

      <div>
        <label htmlFor="whatif-driver" className="block text-xs font-titillium font-bold text-white/60 mb-2">DRIVER</label>
        <select
          id="whatif-driver"
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
          className="w-full md:w-72 bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red"
        >
          {drivers.map((d) => (
            <option key={d.code} value={d.code}>{d.code}{nameFor[d.code] ? ` — ${nameFor[d.code]}` : ""}</option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        <StintBar stints={actual} label={`${driver} — actual strategy`} />
        {changes.length > 0 && !preview.error && <StintBar stints={previewStints} label="Your version" />}
      </div>

      {actual.length > 1 && (
        <div className="space-y-3">
          <div className="text-xs font-titillium font-bold text-white/60">MOVE A PIT STOP</div>
          {shifts.map((shift, i) => {
            const before = pitLaps(actual)[i];
            const after = pitLaps(preview.stints)[i];
            return (
              <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-black/30 p-3 rounded-md border border-white/5">
                <label htmlFor={`shift-${i}`} className="text-sm text-white/70 font-titillium w-40">
                  Stop {i + 1} <span className="text-white/40">(lap {before})</span>
                </label>
                <input
                  id={`shift-${i}`}
                  type="range"
                  min={-15}
                  max={15}
                  step={1}
                  value={shift}
                  onChange={(e) => setShifts((prev) => prev.map((v, j) => (j === i ? parseInt(e.target.value) : v)))}
                  className="flex-1 min-w-[140px] accent-f1-red"
                />
                <span className="text-sm font-titillium tabular-nums text-white w-36 text-right">
                  {shift === 0 ? "no change" : `${shift > 0 ? "+" : "−"}${Math.abs(shift)} laps → lap ${after}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <div className="text-xs font-titillium font-bold text-white/60">CHANGE A TYRE COMPOUND</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {compounds.map((compound, i) => (
            <div key={i} className="flex items-center gap-3 bg-black/30 p-3 rounded-md border border-white/5">
              <label htmlFor={`compound-${i}`} className="text-sm text-white/70 font-titillium">Stint {i + 1}</label>
              <select
                id={`compound-${i}`}
                value={compound}
                onChange={(e) => setCompounds((prev) => prev.map((c, j) => (j === i ? e.target.value : c)))}
                className="flex-1 bg-black/50 border border-white/10 text-white rounded-md px-3 py-1.5 text-sm font-titillium"
              >
                {COMPOUNDS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {preview.error && <p className="text-red-400 text-sm font-titillium" role="alert">{preview.error}</p>}

      <button
        onClick={run}
        disabled={!canRun}
        className="bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2.5 px-8 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {changes.length === 0 ? "Change something to run" : "Run what-if"}
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg font-titillium text-sm" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="border-t border-white/10 pt-5 space-y-4" role="status">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40">Estimated race-time change</div>
              <div
                className={`text-4xl font-black font-titillium tabular-nums ${
                  Math.abs(result.delta_seconds) < 0.05 ? "text-white" : result.delta_seconds < 0 ? "text-f1-green" : "text-f1-red"
                }`}
              >
                {formatDelta(result.delta_seconds)}<span className="text-lg font-bold text-white/50"> s</span>
              </div>
            </div>
            <span
              className={`text-[11px] font-bold uppercase px-2 py-1 rounded border ${
                result.confidence === "low" ? "text-f1-yellow border-f1-yellow/40 bg-f1-yellow/10" : "text-white/60 border-white/20"
              }`}
            >
              {result.confidence} confidence
            </span>
          </div>

          <div className="space-y-3">
            <StintBar stints={result.actual_stints} label="Actual" />
            <StintBar stints={result.modified_stints} label="What-if" />
          </div>

          <div>
            <p className="text-white/80 font-titillium leading-relaxed">{result.explanation}</p>
            <p className="text-[11px] text-white/30 font-titillium mt-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {result.explanation_source === "ai" ? "Explained by AI from the model's numbers" : "Auto-generated from the model's numbers"}
            </p>
          </div>

          {result.notes.length > 0 && (
            <ul className="space-y-1.5">
              {result.notes.map((note, i) => (
                <li key={i} className="text-xs text-white/40 font-titillium flex gap-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
