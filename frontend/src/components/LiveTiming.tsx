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
      <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
        <h2 className="text-sm font-bold tracking-widest text-f1-red uppercase flex items-center gap-2 font-titillium">
          <span className="h-2 w-2 rounded-full bg-f1-red animate-pulse" />
          Live Timing & Gaps
        </h2>
        <span className="text-xs text-white/40 font-titillium font-semibold tracking-wider">LAPS COMPLETED</span>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-sm font-titillium tracking-wide">
          <thead className="sticky top-0 bg-black/80 backdrop-blur-md z-10">
            <tr className="text-white/40 border-b border-f1-red/30 pb-2 text-xs">
              <th className="py-2 font-bold px-1">POS</th>
              <th className="py-2 font-bold px-1">DRIVER</th>
              <th className="py-2 font-bold px-1">GAP</th>
              <th className="py-2 font-bold px-1">INT</th>
              <th className="py-2 font-bold px-1">LAST LAP</th>
              <th className="py-2 font-bold px-1">S1</th>
              <th className="py-2 font-bold px-1">S2</th>
              <th className="py-2 font-bold px-1">S3</th>
              <th className="py-2 font-bold px-1">TYRE</th>
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
                  className={`border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${
                    isSelected ? "bg-white/10 border-l-2 border-l-f1-red" : "border-l-2 border-l-transparent"
                  }`}
                >
                  <td className="py-2.5 px-1 font-bold">{timing.position || "-"}</td>
                  <td className="py-2.5 px-1 flex items-center gap-2 font-semibold">
                    <span
                      className="inline-block w-1.5 h-4 rounded-sm"
                      style={{ backgroundColor: driver.team_color }}
                    />
                    <span className="uppercase tracking-widest">{driver.code}</span>
                  </td>
                  <td className="py-2.5 px-1 font-medium text-white/90">
                    {timing.gap_to_leader === 0 ? "LEADER" : timing.gap_to_leader ? `+${timing.gap_to_leader.toFixed(3)}` : "-"}
                  </td>
                  <td className="py-2.5 px-1 text-white/60">
                    {timing.gap_to_next === 0 ? "-" : timing.gap_to_next ? `+${timing.gap_to_next.toFixed(3)}` : "-"}
                  </td>
                  <td className="py-2.5 px-1 text-white/90 font-bold">
                    {timing.last_lap_time ? timing.last_lap_time.toFixed(3) : "-"}
                  </td>
                  <td className="py-2.5 px-1 text-white/70">{timing.s1 ? timing.s1.toFixed(3) : "-"}</td>
                  <td className="py-2.5 px-1 text-white/70">{timing.s2 ? timing.s2.toFixed(3) : "-"}</td>
                  <td className="py-2.5 px-1 text-white/70">{timing.s3 ? timing.s3.toFixed(3) : "-"}</td>
                  <td className={`py-2.5 px-1 font-bold ${tyreColor}`}>
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
