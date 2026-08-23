"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { Loader2, Trophy, Medal } from "lucide-react";

interface DriverStanding {
  position: number;
  points: number;
  wins: number;
  driver_name: string;
  driver_code: string;
  driver_number: number | null;
  team_name: string;
}

interface ConstructorStanding {
  position: number;
  points: number;
  wins: number;
  team_name: string;
}

interface StandingsResponse {
  year: number;
  driver_standings: DriverStanding[];
  constructor_standings: ConstructorStanding[];
}

export default function StatsPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStandings();
  }, [year]);

  const fetchStandings = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get<StandingsResponse>(`/api/v1/stats/standings?year=${year}`);
      setStandings(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load standings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
            <Trophy className="w-8 h-8 text-f1-red" />
            Season Statistics
          </h1>
          <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
            World Championship Standings
          </p>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-titillium font-bold text-white/60">SEASON</label>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red transition-colors"
          >
            {Array.from({ length: currentYear - 2018 + 1 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg font-titillium">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <Loader2 className="w-8 h-8 text-f1-red animate-spin" />
          <p className="text-white/50 font-titillium tracking-widest text-sm">LOADING STANDINGS...</p>
        </div>
      ) : standings ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Driver Standings */}
          <div className="glass-panel p-6 rounded-xl border border-white/5">
            <h2 className="text-xl font-bold tracking-widest text-white uppercase mb-6 flex items-center gap-2">
              <Medal className="w-5 h-5 text-f1-yellow" />
              Drivers' Championship
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-titillium">
                <thead>
                  <tr className="text-white/40 border-b border-white/10 text-xs">
                    <th className="pb-3 font-bold px-2">POS</th>
                    <th className="pb-3 font-bold px-2">DRIVER</th>
                    <th className="pb-3 font-bold px-2">TEAM</th>
                    <th className="pb-3 font-bold px-2 text-right">PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.driver_standings.map((driver) => (
                    <tr key={driver.driver_code} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-2 font-bold text-white/80">{driver.position}</td>
                      <td className="py-3 px-2">
                        <div className="flex flex-col">
                          <span className="font-bold text-white">{driver.driver_name}</span>
                          <span className="text-xs text-white/40">{driver.driver_code}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-white/60 text-sm">{driver.team_name}</td>
                      <td className="py-3 px-2 text-right font-black text-f1-red">{driver.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Constructor Standings */}
          <div className="glass-panel p-6 rounded-xl border border-white/5 h-fit">
            <h2 className="text-xl font-bold tracking-widest text-white uppercase mb-6 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-f1-red" />
              Constructors' Championship
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-titillium">
                <thead>
                  <tr className="text-white/40 border-b border-white/10 text-xs">
                    <th className="pb-3 font-bold px-2">POS</th>
                    <th className="pb-3 font-bold px-2">TEAM</th>
                    <th className="pb-3 font-bold px-2 text-center">WINS</th>
                    <th className="pb-3 font-bold px-2 text-right">PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.constructor_standings.map((team) => (
                    <tr key={team.team_name} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-2 font-bold text-white/80">{team.position}</td>
                      <td className="py-3 px-2 font-bold text-white">{team.team_name}</td>
                      <td className="py-3 px-2 text-center text-white/60">{team.wins}</td>
                      <td className="py-3 px-2 text-right font-black text-f1-red">{team.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
