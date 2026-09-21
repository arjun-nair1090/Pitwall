"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { User, Trophy, FileText } from "lucide-react";
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

interface SeasonInsight {
  event: string;
  document: string;
}

interface SeasonInsightsResponse {
  driver_code: string;
  year: number;
  standing: DriverStanding | null;
  insights: SeasonInsight[];
}

export default function DriverSeasonPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { year?: string };
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(parseInt(searchParams.year || "") || currentYear);
  const [data, setData] = useState<SeasonInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const driverCode = params.code.toUpperCase();

  const fetchData = () => {
    setLoading(true);
    setError("");
    axios
      .get<SeasonInsightsResponse>(`/api/v1/drivers/${driverCode}/season-insights?year=${year}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(getApiErrorMessage(err, "Failed to load driver season data.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverCode, year]);

  return (
    <div className="w-full py-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
            <User className="w-8 h-8 text-f1-red" />
            {driverCode}
          </h1>
          <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
            {data?.standing?.driver_name || "Season Overview"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="text-sm font-titillium font-bold text-white/60">SEASON</label>
          <select aria-label="Season"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red"
          >
            {Array.from({ length: currentYear - 2018 + 1 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-8">
          <div className="glass-panel p-6 rounded-xl border border-white/5 grid grid-cols-2 md:grid-cols-4 gap-6 animate-pulse" role="status" aria-label="Loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-2.5 w-14 bg-white/10 rounded" />
                <div className="h-7 w-20 bg-white/5 rounded" />
              </div>
            ))}
          </div>
          <TableSkeleton rows={4} columns={2} />
        </div>
      ) : error ? (
        <ErrorState title="Couldn't load driver season" message={error} onRetry={fetchData} />
      ) : data ? (
        <div className="space-y-8">
          {data.standing ? (
            <div className="glass-panel p-6 rounded-xl border border-white/5 grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-[10px] text-white/40 uppercase">Position</div>
                <div className="text-2xl font-bold text-white font-titillium mt-1">P{data.standing.position}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/40 uppercase">Points</div>
                <div className="text-2xl font-bold text-f1-red font-titillium mt-1">{data.standing.points}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/40 uppercase">Wins</div>
                <div className="text-2xl font-bold text-white font-titillium mt-1">{data.standing.wins}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/40 uppercase">Team</div>
                <div className="text-lg font-bold text-white font-titillium mt-1">{data.standing.team_name}</div>
              </div>
            </div>
          ) : (
            <div className="glass-panel p-6 rounded-xl border border-white/5 text-white/40 text-sm font-titillium">
              No {year} championship standing found for {driverCode}.
            </div>
          )}

          <div>
            <h2 className="text-xl font-bold tracking-widest text-white uppercase mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-f1-yellow" />
              Race-by-Race Insights
            </h2>
            {data.insights.length > 0 ? (
              <div className="space-y-3">
                {data.insights.map((insight) => (
                  <div key={insight.event} className="glass-panel p-4 rounded-lg border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-f1-cyan" />
                      <h3 className="text-sm font-bold text-white uppercase tracking-wide">{insight.event}</h3>
                    </div>
                    <p className="text-white/60 text-sm font-titillium leading-relaxed">{insight.document}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-panel p-6 rounded-xl border border-white/5 text-white/40 text-sm font-titillium">
                No race-by-race insights yet for {year} — the historical corpus for this season
                hasn't been ingested. Run{" "}
                <code className="bg-black/50 px-1.5 py-0.5 rounded text-f1-cyan">
                  python -m app.scripts.ingest_history --years {year}
                </code>{" "}
                to unlock this.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
