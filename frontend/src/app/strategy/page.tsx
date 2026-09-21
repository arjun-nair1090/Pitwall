"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { FlaskConical, Loader2, AlertTriangle, Plus, Trash2 } from "lucide-react";
import CompoundBadge from "@/components/CompoundBadge";
import { getApiErrorMessage } from "@/lib/apiError";

interface Stint {
  compound: string;
  laps: number;
}

interface SimulationResult {
  predicted_total_seconds: number;
  predicted_avg_lap_seconds: number;
  num_pit_stops: number;
  pit_loss_seconds_used: number;
  actual_driver_total_seconds?: number;
  delta_seconds?: number;
}

const COMPOUNDS = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.padStart(6, "0")}` : `${m}:${s.padStart(6, "0")}`;
}

export default function StrategySimulatorPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [gp, setGp] = useState("");
  const [availableGPs, setAvailableGPs] = useState<string[]>([]);
  const [driverCode, setDriverCode] = useState("");
  const [availableDrivers, setAvailableDrivers] = useState<string[]>([]);
  const [stints, setStints] = useState<Stint[]>([{ compound: "MEDIUM", laps: 20 }]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");

  const loadOptions = () => {
    setOptionsError("");
    Promise.all([
      axios.get(`/api/v1/races/historical?year=${year}`),
      axios.get("/api/v1/drivers/known-codes"),
    ])
      .then(([racesRes, driversRes]) => {
        const gps: string[] = Array.from(new Set<string>(racesRes.data.map((r: any) => r.country)));
        setAvailableGPs(gps);
        if (!gps.includes(gp)) setGp(gps[0] || "");
        setAvailableDrivers(driversRes.data.driver_standings.map((d: any) => d.driver_code));
      })
      .catch(() => setOptionsError("Couldn't load the race calendar or driver list."));
  };

  useEffect(() => {
    loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const totalLaps = stints.reduce((sum, s) => sum + (s.laps || 0), 0);

  const updateStint = (index: number, patch: Partial<Stint>) => {
    setStints((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addStint = () => setStints((prev) => [...prev, { compound: "HARD", laps: 15 }]);
  const removeStint = (index: number) => setStints((prev) => prev.filter((_, i) => i !== index));

  const runSimulation = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await axios.post<SimulationResult>("/api/v1/strategy/simulate", {
        year,
        gp,
        session: "Race",
        stints,
        ...(driverCode && { driver_code: driverCode.toUpperCase() }),
      });
      setResult(res.data);
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Simulation failed."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full py-4 md:p-8 max-w-5xl mx-auto space-y-8 flex flex-col">
      <div className="pb-5">
        <h1 className="font-display text-3xl font-extrabold leading-none tracking-tight text-chalk md:text-4xl">
          Strategy simulator
        </h1>
        <p className="mt-2 max-w-prose text-sm text-mute">
          Predict a hypothetical tire strategy using a degradation model fit to the real session
        </p>
      </div>

      <div className="rounded-panel border border-gantry bg-kerb p-6 space-y-6">
        {optionsError && (
          <div className="bg-live/10 border border-live/40 text-live-text p-3 rounded-panel flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{optionsError}</span>
            <button type="button" onClick={loadOptions} className="font-bold underline underline-offset-2 hover:text-chalk">
              Retry
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-mute mb-2">YEAR</label>
            <input aria-label="Year" type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 " />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-mute mb-2">Grand Prix</label>
            <select aria-label="Grand Prix" value={gp} onChange={(e) => setGp(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 ">
              {availableGPs.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-mute mb-2">Compare to driver (optional)</label>
            <select aria-label="Compare To Driver (Optional)" value={driverCode} onChange={(e) => setDriverCode(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 ">
              <option value="">None</option>
              {availableDrivers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-mute">STINT PLAN ({totalLaps} laps total)</label>
            <button onClick={addStint} className="flex items-center gap-1 text-xs text-chalk hover:text-chalk font-bold">
              <Plus className="w-3.5 h-3.5" /> ADD STINT
            </button>
          </div>
          <div className="space-y-2">
            {stints.map((stint, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-kerb p-3 rounded-panel border border-gantry">
                <span className="text-xs text-faint font-bold w-16">STINT {i + 1}</span>
                <CompoundBadge compound={stint.compound} />
                <select aria-label={`Stint ${i + 1} compound`} value={stint.compound} onChange={(e) => updateStint(i, { compound: e.target.value })} className="bg-kerb border border-gantry text-chalk rounded-panel px-3 py-1.5 text-sm">
                  {COMPOUNDS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  aria-label={`Stint ${i + 1} laps`}
                  type="number"
                  value={stint.laps}
                  onChange={(e) => updateStint(i, { laps: parseInt(e.target.value) || 0 })}
                  className="w-20 bg-kerb border border-gantry text-chalk rounded-panel px-3 py-1.5 text-sm"
                />
                <span className="text-xs text-faint">laps</span>
                {stints.length > 1 && (
                  <button onClick={() => removeStint(i)} className="ml-auto text-faint hover:text-chalk">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={runSimulation}
          disabled={loading || !gp}
          className="bg-chalk text-tarmac hover:bg-white hover:bg-live/90 font-bold py-2.5 px-8 rounded-panel transition-colors flex items-center gap-2 disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          RUN SIMULATION
        </button>
      </div>

      {error && (
        <div className="bg-live/10 border border-live/40 text-live-text p-4 rounded-panel flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-panel border border-gantry bg-kerb p-6 border-live/40 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-[10px] text-faint">Predicted Total Time</div>
            <div className="text-2xl font-bold text-chalk mt-1">{formatTime(result.predicted_total_seconds)}</div>
          </div>
          <div>
            <div className="text-[10px] text-faint">Avg Lap</div>
            <div className="text-2xl font-bold text-chalk mt-1">{result.predicted_avg_lap_seconds.toFixed(3)}s</div>
          </div>
          <div>
            <div className="text-[10px] text-faint">Pit Stops</div>
            <div className="text-2xl font-bold text-chalk mt-1">{result.num_pit_stops} <span className="text-xs text-faint">(~{result.pit_loss_seconds_used.toFixed(1)}s each)</span></div>
          </div>
          {result.delta_seconds !== undefined && (
            <div>
              <div className="text-[10px] text-faint">vs Actual Race</div>
              <div className={`text-2xl font-bold mt-1${result.delta_seconds < 0 ? "text-timing-green" : "text-chalk"}`}>
                {result.delta_seconds < 0 ? "-" : "+"}{Math.abs(result.delta_seconds).toFixed(1)}s
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
