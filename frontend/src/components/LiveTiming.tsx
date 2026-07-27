"use client";

import React from "react";
import { useF1Store } from "@/store/useTelemetryStore";

export default function LiveTiming() {
  const { leaderboard, drivers, selectedDriverNum, setSelectedDriverNum } = useF1Store();

  const driversMap = React.useMemo(() => {
    return new Map(drivers.map((d) => [d.driver_number, d]));
  }, [drivers]);

  // Sort by position
  const sortedLeaderboard = React.useMemo(() => {
    return Object.entries(leaderboard)
      .map(([numStr, timing]) => ({
        number: parseInt(numStr),
        timing,
        driver: driversMap.get(parseInt(numStr)),
      }))
      .sort((a, b) => (a.timing.position || 99) - (b.timing.position || 99));
  }, [leaderboard, driversMap]);

  return (
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col overflow-hidden border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold tracking-wider text-f1-red uppercase flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-f1-red animate-ping" />
          Live Timing & Gaps
        </h2>
        <span className="text-xs text-white/40 font-mono-f1">LAPS COMPLETED</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-xs font-mono-f1">
          <thead>
            <tr className="text-white/40 border-b border-white/10 pb-2">
              <th className="py-2 font-normal">POS</th>
              <th className="py-2 font-normal">DRIVER</th>
              <th className="py-2 font-normal">GAP</th>
              <th className="py-2 font-normal">INT</th>
              <th className="py-2 font-normal">LAST LAP</th>
              <th className="py-2 font-normal">S1</th>
              <th className="py-2 font-normal">S2</th>
              <th className="py-2 font-normal">S3</th>
              <th className="py-2 font-normal">TYRE</th>
            </tr>
          </thead>
          <tbody>
            {sortedLeaderboard.map(({ number, timing, driver }) => {
              if (!driver) return null;
              const isSelected = selectedDriverNum === number;
              
              // Tyres
              const tyreColor = 
                timing.compound?.toLowerCase().includes("soft") ? "text-f1-red" :
                timing.compound?.toLowerCase().includes("medium") ? "text-f1-yellow" :
                timing.compound?.toLowerCase().includes("hard") ? "text-white" : "text-f1-green";

              return (
                <tr
                  key={number}
                  onClick={() => setSelectedDriverNum(isSelected ? null : number)}
                  className={`border-b border-white/5 cursor-pointer transition-colors ${
                    isSelected ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <td className="py-2.5 font-bold">{timing.position || "-"}</td>
                  <td className="py-2.5 flex items-center gap-2 font-semibold">
                    <span
                      className="inline-block w-1.5 h-3.5"
                      style={{ backgroundColor: driver.team_color }}
                    />
                    <span>{driver.code}</span>
                  </td>
                  <td className="py-2.5 text-white/80">
                    {timing.gap_to_leader === 0 ? "LEADER" : timing.gap_to_leader ? `+${timing.gap_to_leader.toFixed(3)}s` : "-"}
                  </td>
                  <td className="py-2.5 text-white/60">
                    {timing.gap_to_next === 0 ? "-" : timing.gap_to_next ? `+${timing.gap_to_next.toFixed(3)}s` : "-"}
                  </td>
                  <td className="py-2.5 text-white/90">
                    {timing.lap_time ? timing.lap_time.toFixed(3) : "-"}
                  </td>
                  <td className="py-2.5 text-white/70">{timing.s1 ? timing.s1.toFixed(3) : "-"}</td>
                  <td className="py-2.5 text-white/70">{timing.s2 ? timing.s2.toFixed(3) : "-"}</td>
                  <td className="py-2.5 text-white/70">{timing.s3 ? timing.s3.toFixed(3) : "-"}</td>
                  <td className={`py-2.5 font-bold ${tyreColor}`}>
                    {timing.compound ? `${timing.compound[0]}${timing.tyre_age ? ` (${timing.tyre_age})` : ""}` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
