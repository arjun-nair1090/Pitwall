"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Trophy, Medal } from "lucide-react";
import TableSkeleton from "@/components/TableSkeleton";
import ErrorState from "@/components/ErrorState";
import { getApiErrorMessage } from "@/lib/apiError";

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
      setError(getApiErrorMessage(err, "Failed to load standings."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full py-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold leading-none tracking-tight text-chalk md:text-4xl">
            Season stats
          </h1>
          <p className="mt-2 max-w-prose text-sm text-mute">
            World Championship Standings
          </p>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-bold text-mute">Season</label>
          <select aria-label="Season"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="bg-kerb border border-gantry text-chalk rounded-panel px-4 py-2 focus:outline-none focus:border-live/40 transition-colors"
          >
            {Array.from({ length: currentYear - 2018 + 1 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <TableSkeleton rows={10} columns={4} />
          <TableSkeleton rows={10} columns={4} />
        </div>
      ) : error ? (
        <ErrorState title="Couldn't load standings" message={error} onRetry={fetchStandings} />
      ) : standings ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Driver Standings */}
          <div className="rounded-panel border border-gantry bg-kerb p-6">
            <h2 className="text-xl font-bold text-chalk mb-6 flex items-center gap-2">
              <Medal className="w-5 h-5 text-mute" />
              Drivers' Championship
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left tabular-nums">
                <thead>
                  <tr className="text-faint border-b border-gantry text-xs">
                    <th className="pb-3 font-bold px-2">POS</th>
                    <th className="pb-3 font-bold px-2">Driver</th>
                    <th className="pb-3 font-bold px-2">TEAM</th>
                    <th className="pb-3 font-bold px-2 text-right">PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.driver_standings.map((driver) => (
                    <tr key={driver.driver_code} className="border-b border-gantry hover:bg-raised transition-colors">
                      <td className="py-3 px-2 font-bold text-mute">{driver.position}</td>
                      <td className="py-3 px-2">
                        <Link href={`/drivers/${driver.driver_code}?year=${year}`} className="flex flex-col hover:opacity-80 transition-opacity">
                          <span className="font-bold text-chalk">{driver.driver_name}</span>
                          <span className="text-xs text-faint">{driver.driver_code}</span>
                        </Link>
                      </td>
                      <td className="py-3 px-2 text-mute text-sm">{driver.team_name}</td>
                      <td className="py-3 px-2 text-right font-black text-chalk">{driver.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Constructor Standings */}
          <div className="rounded-panel border border-gantry bg-kerb p-6 h-fit">
            <h2 className="text-xl font-bold text-chalk mb-6 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-mute" />
              Constructors' Championship
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left tabular-nums">
                <thead>
                  <tr className="text-faint border-b border-gantry text-xs">
                    <th className="pb-3 font-bold px-2">POS</th>
                    <th className="pb-3 font-bold px-2">TEAM</th>
                    <th className="pb-3 font-bold px-2 text-center">WINS</th>
                    <th className="pb-3 font-bold px-2 text-right">PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.constructor_standings.map((team) => (
                    <tr key={team.team_name} className="border-b border-gantry hover:bg-raised transition-colors">
                      <td className="py-3 px-2 font-bold text-mute">{team.position}</td>
                      <td className="py-3 px-2 font-bold text-chalk">{team.team_name}</td>
                      <td className="py-3 px-2 text-center text-mute">{team.wins}</td>
                      <td className="py-3 px-2 text-right font-black text-chalk">{team.points}</td>
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
