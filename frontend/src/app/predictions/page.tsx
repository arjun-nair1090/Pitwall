"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Trophy, Target, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";

interface RaceOption {
  country: string;
  location: string;
  event_name: string;
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

export default function PredictionsPage() {
  const currentUser = useF1Store((s) => s.currentUser);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [eventName, setEventName] = useState("");
  const [availableDrivers, setAvailableDrivers] = useState<string[]>([]);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [p3, setP3] = useState("");
  const [myPredictions, setMyPredictions] = useState<Prediction[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`/api/v1/races/historical?year=${year}`).then((res) => {
      const opts: RaceOption[] = res.data;
      setRaces(opts);
      if (!opts.some((r) => r.event_name === eventName)) {
        setEventName(opts[0]?.event_name || "");
      }
    }).catch(() => {});

    axios.get("/api/v1/drivers/known-codes").then((res) => {
      setAvailableDrivers(res.data.driver_standings.map((d: any) => d.driver_code));
    }).catch(() => {});

    axios.get("/api/v1/leaderboard", { params: { year } }).then((res) => {
      setLeaderboard(res.data);
    }).catch(() => {});

    if (currentUser) {
      axios.get("/api/v1/predictions/me", { params: { year } }).then((res) => {
        setMyPredictions(res.data);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, currentUser]);

  const submitPrediction = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await axios.post("/api/v1/predictions", {
        year,
        event_name: eventName,
        predicted_p1: p1,
        predicted_p2: p2,
        predicted_p3: p3,
      });
      setSuccess("Prediction submitted.");
      const res = await axios.get("/api/v1/predictions/me", { params: { year } });
      setMyPredictions(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div className="border-b border-white/10 pb-6">
        <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
          <Target className="w-8 h-8 text-f1-red" />
          Predictions
        </h1>
        <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
          Call the top 3 for an upcoming race. 25 points for an exact podium, 10 points per driver named anywhere in the real top 3.
        </p>
      </div>

      {!currentUser ? (
        <div className="glass-panel p-6 rounded-xl border border-white/5 text-center space-y-3">
          <Lock className="w-6 h-6 text-white/40 mx-auto" />
          <p className="text-white/60 font-titillium">Log in to submit a prediction.</p>
          <Link href="/login" className="inline-block bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2 px-6 rounded-md transition-colors">
            Log In
          </Link>
        </div>
      ) : (
        <form onSubmit={submitPrediction} className="glass-panel p-6 rounded-xl border border-white/5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-titillium font-bold text-white/60 mb-2">YEAR</label>
              <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red" />
            </div>
            <div>
              <label className="block text-xs font-titillium font-bold text-white/60 mb-2">GRAND PRIX</label>
              <select value={eventName} onChange={(e) => setEventName(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
                {races.map((r) => <option key={r.event_name} value={r.event_name}>{r.country}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "P1", value: p1, set: setP1 },
              { label: "P2", value: p2, set: setP2 },
              { label: "P3", value: p3, set: setP3 },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label className="block text-xs font-titillium font-bold text-white/60 mb-2">{label}</label>
                <select value={value} onChange={(e) => set(e.target.value)} required className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
                  <option value="">Select driver</option>
                  {availableDrivers.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg font-titillium flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
          {success && (
            <div className="bg-f1-green/10 border border-f1-green/30 text-f1-green p-3 rounded-lg font-titillium flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !eventName}
            className="bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2.5 px-8 rounded-md transition-colors disabled:opacity-40"
          >
            Submit Prediction
          </button>
        </form>
      )}

      {currentUser && myPredictions.length > 0 && (
        <div className="glass-panel p-6 rounded-xl border border-white/5">
          <h2 className="text-lg font-bold text-white uppercase font-titillium mb-4">Your Predictions ({year})</h2>
          <div className="space-y-2">
            {myPredictions.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-black/30 p-3 rounded-md border border-white/5 text-sm font-titillium">
                <span className="text-white/70">{p.event_name}</span>
                <span className="text-white">{p.predicted_p1} / {p.predicted_p2} / {p.predicted_p3}</span>
                <span className="text-white/40">{p.points_awarded === null ? "Not scored yet" : `${p.points_awarded} pts`}</span>
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
        {leaderboard.length === 0 ? (
          <p className="text-white/40 font-titillium text-sm">No scored predictions yet for {year}.</p>
        ) : (
          <div className="space-y-1">
            {leaderboard.map((row, i) => (
              <div key={row.display_name} className="flex items-center justify-between bg-black/30 p-3 rounded-md border border-white/5 text-sm font-titillium">
                <span className="text-white/60 w-8">#{i + 1}</span>
                <span className="text-white flex-1">{row.display_name}</span>
                <span className="text-f1-red font-bold">{row.total_points} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
