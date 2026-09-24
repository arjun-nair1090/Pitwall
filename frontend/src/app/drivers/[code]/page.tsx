"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { Trophy, FileText } from "lucide-react";
import TableSkeleton from "@/components/TableSkeleton";
import ErrorState from "@/components/ErrorState";
import { getApiErrorMessage } from "@/lib/apiError";
import PageHeader from "@/components/ui/PageHeader";
import Select from "@/components/ui/Select";

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
    <div className="w-full py-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <PageHeader
        title={driverCode}
        description={data?.standing?.driver_name || "Season overview"}
        actions={
          <Select label="Season" value={year} onChange={(e) => setYear(parseInt(e.target.value))} selectClassName="w-32 tabular-nums">
            {Array.from({ length: currentYear - 2018 + 1 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        }
      />

      {loading ? (
        <div className="space-y-8">
          <div className="rounded-panel border border-gantry bg-kerb p-6 grid grid-cols-2 md:grid-cols-4 gap-6 animate-pulse" role="status" aria-label="Loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-2.5 w-14 bg-raised rounded-control" />
                <div className="h-7 w-20 bg-raised rounded-control" />
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
            <div className="rounded-panel border border-gantry bg-kerb p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-[10px] text-faint">Position</div>
                <div className="text-2xl font-bold text-chalk mt-1">P{data.standing.position}</div>
              </div>
              <div>
                <div className="text-[10px] text-faint">Points</div>
                <div className="text-2xl font-bold text-chalk mt-1">{data.standing.points}</div>
              </div>
              <div>
                <div className="text-[10px] text-faint">Wins</div>
                <div className="text-2xl font-bold text-chalk mt-1">{data.standing.wins}</div>
              </div>
              <div>
                <div className="text-[10px] text-faint">Team</div>
                <div className="text-lg font-bold text-chalk mt-1">{data.standing.team_name}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-panel border border-gantry bg-kerb p-6 text-faint text-sm">
              No {year} championship standing found for {driverCode}.
            </div>
          )}

          <div>
            <h2 className="text-xl font-bold text-chalk mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-mute" />
              Race-by-Race Insights
            </h2>
            {data.insights.length > 0 ? (
              <div className="space-y-3">
                {data.insights.map((insight) => (
                  <div key={insight.event} className="rounded-panel border border-gantry bg-kerb p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-chalk" />
                      <h3 className="text-sm font-bold text-chalk">{insight.event}</h3>
                    </div>
                    <p className="text-mute text-sm leading-relaxed">{insight.document}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-panel border border-gantry bg-kerb p-6 text-faint text-sm">
                No race-by-race insights yet for {year} — the historical corpus for this season
                hasn't been ingested. Run{" "}
                <code className="bg-kerb px-1.5 py-0.5 rounded-control text-chalk">
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
