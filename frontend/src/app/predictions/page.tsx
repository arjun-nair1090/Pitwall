"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Trophy, Target, Lock, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";
import ErrorState from "@/components/ErrorState";
import { getApiErrorMessage } from "@/lib/apiError";

interface RaceOption {
  country: string;
  location: string;
  event_name: string;
  race_start_utc: string | null;
}

interface DriverOption {
  code: string;
  name: string;
}

interface Prediction {
  id: number;
  year: number;
  event_name: string;
  predicted_p1: string;
  predicted_p2: string;
  predicted_p3: string;
  points_awarded: number | null;
}

interface LeaderboardRow {
  display_name: string;
  total_points: number;
}

const FIRST_SEASON = 2018;

// A race is open for predictions until lights-out. The server enforces this
// authoritatively; this only decides what the UI offers.
function isOpen(race: RaceOption, now: number): boolean {
  return race.race_start_utc !== null && Date.parse(race.race_start_utc) > now;
}

function formatRaceDate(race: RaceOption): string {
  if (!race.race_start_utc) return "date TBC";
  return new Date(race.race_start_utc).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// The real grid for the season, from championship standings. Early in a season
// (before any race) there are no standings yet, so fall back to last season's
// grid, and finally to the static list, rather than offering nothing.
async function loadSeasonDrivers(year: number): Promise<DriverOption[]> {
  for (const candidate of [year, year - 1]) {
    try {
      const res = await axios.get("/api/v1/stats/standings", { params: { year: candidate } });
      const drivers: DriverOption[] = (res.data?.driver_standings || [])
        .filter((d: any) => d.driver_code)
        .map((d: any) => ({ code: String(d.driver_code).toUpperCase(), name: d.driver_name || d.driver_code }));
      if (drivers.length > 0) return drivers;
    } catch {
      // try the next source
    }
  }
  const res = await axios.get("/api/v1/drivers/known-codes");
  return res.data.driver_standings.map((d: any) => ({ code: d.driver_code, name: d.driver_code }));
}

export default function PredictionsPage() {
  const currentUser = useF1Store((s) => s.currentUser);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [eventName, setEventName] = useState("");
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [picks, setPicks] = useState<[string, string, string]>(["", "", ""]);
  const [myPredictions, setMyPredictions] = useState<Prediction[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const now = Date.now();
  const openRaces = useMemo(() => races.filter((r) => isOpen(r, now)), [races, now]);
  const selectedRace = races.find((r) => r.event_name === eventName);
  const selectedIsOpen = selectedRace ? isOpen(selectedRace, now) : false;

  const loadFormOptions = useCallback(() => {
    setOptionsLoading(true);
    setOptionsError("");
    Promise.all([axios.get(`/api/v1/races/historical?year=${year}`), loadSeasonDrivers(year)])
      .then(([racesRes, seasonDrivers]) => {
        const calendar: RaceOption[] = racesRes.data;
        setRaces(calendar);
        setDrivers(seasonDrivers);
        // Default to the next race that's still open, not the first of the season.
        const next = calendar.find((r) => isOpen(r, Date.now()));
        setEventName(next?.event_name || "");
      })
      .catch((err) => setOptionsError(getApiErrorMessage(err, "Couldn't load the race calendar or driver list.")))
      .finally(() => setOptionsLoading(false));
  }, [year]);

  const loadLeaderboard = useCallback(() => {
    setLeaderboardLoading(true);
    setLeaderboardError("");
    axios
      .get("/api/v1/leaderboard", { params: { year } })
      .then((res) => setLeaderboard(res.data))
      .catch((err) => setLeaderboardError(getApiErrorMessage(err, "Couldn't load the leaderboard.")))
      .finally(() => setLeaderboardLoading(false));
  }, [year]);

  const loadMyPredictions = useCallback(() => {
    if (!currentUser) {
      setMyPredictions([]);
      return;
    }
    axios
      .get("/api/v1/predictions/me", { params: { year } })
      .then((res) => setMyPredictions(res.data))
      .catch(() => {});
  }, [year, currentUser]);

  useEffect(() => {
    setSuccess("");
    setError("");
    loadFormOptions();
    loadLeaderboard();
  }, [loadFormOptions, loadLeaderboard]);

  useEffect(() => {
    loadMyPredictions();
  }, [loadMyPredictions]);

  // Switching race clears any message about the previous one. Kept separate from
  // the pre-fill below: saving updates myPredictions, and that must not wipe the
  // "saved" confirmation that was set in the same tick.
  useEffect(() => {
    setSuccess("");
    setError("");
  }, [eventName]);

  // Selecting a race you've already predicted pre-fills your pick so editing is natural.
  useEffect(() => {
    const existing = myPredictions.find((p) => p.event_name === eventName);
    setPicks(existing ? [existing.predicted_p1, existing.predicted_p2, existing.predicted_p3] : ["", "", ""]);
  }, [eventName, myPredictions]);

  const setPick = (index: number, value: string) => {
    setPicks((prev) => {
      const next: [string, string, string] = [...prev] as [string, string, string];
      next[index] = value;
      return next;
    });
    setSuccess("");
  };

  const canSubmit = !submitting && selectedIsOpen && picks.every(Boolean) && new Set(picks).size === 3;

  const submitPrediction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await axios.post("/api/v1/predictions", {
        year,
        event_name: eventName,
        predicted_p1: picks[0],
        predicted_p2: picks[1],
        predicted_p3: picks[2],
      });
      const res = await axios.get("/api/v1/predictions/me", { params: { year } });
      setMyPredictions(res.data);
      // Set after the refetch: updating myPredictions re-runs the pre-fill effect,
      // which clears any message that was set before it.
      setSuccess("Prediction saved. You can change it until lights-out.");
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const driverName = (code: string) => drivers.find((d) => d.code === code)?.name;

  return (
    <div className="w-full py-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div className="border-b border-white/10 pb-6">
        <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
          <Target className="w-8 h-8 text-f1-red" />
          Predictions
        </h1>
        <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
          Call the top 3 for an upcoming race. 25 points for an exact podium, 10 points per driver named anywhere in the real top 3.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <label htmlFor="prediction-season" className="text-sm font-titillium font-bold text-white/60">SEASON</label>
        <select
          id="prediction-season"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          className="bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red"
        >
          {Array.from({ length: currentYear - FIRST_SEASON + 1 }, (_, i) => currentYear - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {!currentUser ? (
        <div className="glass-panel p-6 rounded-xl border border-white/5 text-center space-y-3">
          <Lock className="w-6 h-6 text-white/40 mx-auto" />
          <p className="text-white/60 font-titillium">Log in to submit a prediction.</p>
          <Link href="/login" className="inline-block bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2 px-6 rounded-md transition-colors">
            Log In
          </Link>
        </div>
      ) : optionsError ? (
        <ErrorState title="Couldn't load the prediction form" message={optionsError} onRetry={loadFormOptions} />
      ) : (
        <form onSubmit={submitPrediction} className="glass-panel p-6 rounded-xl border border-white/5 space-y-4">
          <div>
            <label htmlFor="prediction-race" className="block text-xs font-titillium font-bold text-white/60 mb-2">GRAND PRIX</label>
            <select
              id="prediction-race"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              disabled={optionsLoading || races.length === 0}
              className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red disabled:opacity-50"
            >
              {optionsLoading && <option value="">Loading…</option>}
              {!optionsLoading && openRaces.length === 0 && <option value="">No open races</option>}
              {races.map((r) => (
                <option key={r.event_name} value={r.event_name} disabled={!isOpen(r, now)}>
                  {r.country} — {r.event_name} · {formatRaceDate(r)}{isOpen(r, now) ? "" : " (closed)"}
                </option>
              ))}
            </select>
            {!optionsLoading && openRaces.length === 0 && (
              <p className="text-white/40 text-xs font-titillium mt-2">
                Every race in {year} has started, so predictions are closed. The leaderboard below shows the standings.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {["P1", "P2", "P3"].map((label, i) => (
              <div key={label}>
                <label htmlFor={`pick-${label}`} className="block text-xs font-titillium font-bold text-white/60 mb-2">{label}</label>
                <select
                  id={`pick-${label}`}
                  value={picks[i]}
                  onChange={(e) => setPick(i, e.target.value)}
                  disabled={optionsLoading || !selectedIsOpen}
                  className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red disabled:opacity-50"
                >
                  <option value="">Select driver</option>
                  {drivers.map((d) => (
                    // A driver already chosen for another podium slot can't be picked twice.
                    <option key={d.code} value={d.code} disabled={picks.some((p, j) => j !== i && p === d.code)}>
                      {d.code} — {d.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg font-titillium flex items-center gap-2 text-sm" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="bg-f1-green/10 border border-f1-green/30 text-f1-green p-3 rounded-lg font-titillium flex items-center gap-2 text-sm" role="status">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2.5 px-8 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {myPredictions.some((p) => p.event_name === eventName) ? "Update Prediction" : "Submit Prediction"}
          </button>
        </form>
      )}

      {currentUser && myPredictions.length > 0 && (
        <div className="glass-panel p-6 rounded-xl border border-white/5">
          <h2 className="text-lg font-bold text-white uppercase font-titillium mb-4">Your Predictions ({year})</h2>
          <div className="space-y-2">
            {myPredictions.map((p) => (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 bg-black/30 p-3 rounded-md border border-white/5 text-sm font-titillium">
                <span className="text-white/70">{p.event_name}</span>
                <span className="text-white" title={[p.predicted_p1, p.predicted_p2, p.predicted_p3].map((c) => driverName(c) || c).join(" / ")}>
                  {p.predicted_p1} / {p.predicted_p2} / {p.predicted_p3}
                </span>
                <span className={p.points_awarded === null ? "text-white/40" : "text-f1-red font-bold"}>
                  {p.points_awarded === null ? "Not scored yet" : `${p.points_awarded} pts`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel p-6 rounded-xl border border-white/5">
        <h2 className="text-lg font-bold text-white uppercase font-titillium mb-4 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-f1-red" />
          Leaderboard ({year})
        </h2>
        {leaderboardLoading ? (
          <div className="space-y-2 animate-pulse" role="status" aria-label="Loading leaderboard">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-11 bg-white/5 rounded-md" />
            ))}
          </div>
        ) : leaderboardError ? (
          <ErrorState title="Leaderboard unavailable" message={leaderboardError} onRetry={loadLeaderboard} />
        ) : leaderboard.length === 0 ? (
          <p className="text-white/40 font-titillium text-sm">No scored predictions yet for {year}.</p>
        ) : (
          <div className="space-y-1">
            {leaderboard.map((row, i) => (
              <div key={`${row.display_name}-${i}`} className="flex items-center justify-between bg-black/30 p-3 rounded-md border border-white/5 text-sm font-titillium">
                <span className="text-white/60 w-8">#{i + 1}</span>
                <span className="text-white flex-1 truncate">{row.display_name}</span>
                <span className="text-f1-red font-bold">{row.total_points} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
