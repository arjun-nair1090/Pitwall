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
        const gps = racesRes.data.map((r: any) => r.country);
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
    <div className="w-full py-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-fade-in flex flex-col">
      <div className="border-b border-white/10 pb-6">
        <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
          <FlaskConical className="w-8 h-8 text-f1-red" />
          Strategy Simulator
        </h1>
        <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
          Predict a hypothetical tire strategy using a degradation model fit to the real session
        </p>
      </div>

      <div className="glass-panel p-6 rounded-xl border border-white/5 space-y-6">
        {optionsError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg font-titillium flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{optionsError}</span>
            <button type="button" onClick={loadOptions} className="font-bold underline underline-offset-2 hover:text-white">
              Retry
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">YEAR</label>
            <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">GRAND PRIX</label>
            <select value={gp} onChange={(e) => setGp(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
              {availableGPs.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">COMPARE TO DRIVER (OPTIONAL)</label>
            <select value={driverCode} onChange={(e) => setDriverCode(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
              <option value="">None</option>
              {availableDrivers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-titillium font-bold text-white/60">STINT PLAN ({totalLaps} laps total)</label>
            <button onClick={addStint} className="flex items-center gap-1 text-xs text-f1-red hover:text-red-400 font-bold">
              <Plus className="w-3.5 h-3.5" /> ADD STINT
            </button>
          </div>
          <div className="space-y-2">
            {stints.map((stint, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-black/30 p-3 rounded-md border border-white/5">
                <span className="text-xs text-white/40 font-bold w-16">STINT {i + 1}</span>
                <CompoundBadge compound={stint.compound} />
                <select value={stint.compound} onChange={(e) => updateStint(i, { compound: e.target.value })} className="bg-black/50 border border-white/10 text-white rounded-md px-3 py-1.5 text-sm font-titillium">
                  {COMPOUNDS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="number"
                  value={stint.laps}
                  onChange={(e) => updateStint(i, { laps: parseInt(e.target.value) || 0 })}
                  className="w-20 bg-black/50 border border-white/10 text-white rounded-md px-3 py-1.5 text-sm font-titillium"
                />
                <span className="text-xs text-white/40">laps</span>
                {stints.length > 1 && (
                  <button onClick={() => removeStint(i)} className="ml-auto text-white/30 hover:text-f1-red">
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
          className="bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2.5 px-8 rounded-md transition-colors flex items-center gap-2 disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          RUN SIMULATION
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg font-titillium flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {result && (
        <div className="glass-panel p-6 rounded-xl border border-f1-red/30 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-[10px] text-white/40 uppercase">Predicted Total Time</div>
            <div className="text-2xl font-bold text-white font-titillium mt-1">{formatTime(result.predicted_total_seconds)}</div>
          </div>
          <div>
            <div className="text-[10px] text-white/40 uppercase">Avg Lap</div>
            <div className="text-2xl font-bold text-white font-titillium mt-1">{result.predicted_avg_lap_seconds.toFixed(3)}s</div>
          </div>
          <div>
            <div className="text-[10px] text-white/40 uppercase">Pit Stops</div>
            <div className="text-2xl font-bold text-white font-titillium mt-1">{result.num_pit_stops} <span className="text-xs text-white/40">(~{result.pit_loss_seconds_used.toFixed(1)}s each)</span></div>
          </div>
          {result.delta_seconds !== undefined && (
            <div>
              <div className="text-[10px] text-white/40 uppercase">vs Actual Race</div>
              <div className={`text-2xl font-bold font-titillium mt-1 ${result.delta_seconds < 0 ? "text-f1-green" : "text-f1-red"}`}>
                {result.delta_seconds < 0 ? "-" : "+"}{Math.abs(result.delta_seconds).toFixed(1)}s
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
