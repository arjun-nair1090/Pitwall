"use client";

import React, { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";

const MAX_DEFAULT_VISIBLE = 6;

export default function GapEvolutionChart() {
  const gapHistory = useF1Store((s) => s.gapHistory);
  const drivers = useF1Store((s) => s.drivers);
  const leaderboard = useF1Store((s) => s.leaderboard);
  const [hiddenCodes, setHiddenCodes] = useState<Set<string> | null>(null);

  const driversMap = useMemo(() => new Map(drivers.map((d) => [d.driver_number, d])), [drivers]);

  const { chartData, driverCodes } = useMemo(() => {
    const codes: string[] = [];
    const data = gapHistory.map((point) => {
      const row: Record<string, number | null> = { lap: point.lap };
      Object.entries(point.gaps).forEach(([numStr, gap]) => {
        const driver = driversMap.get(parseInt(numStr));
        if (!driver) return;
        row[driver.code] = gap;
        if (!codes.includes(driver.code)) codes.push(driver.code);
      });
      return row;
    });
    return { chartData: data, driverCodes: codes };
  }, [gapHistory, driversMap]);

  // Default: only show the current top N by position -- 20 overlapping lines is unreadable.
  // Anyone can bring a driver back into view by clicking their legend entry.
  const defaultVisible = useMemo(() => {
    const byPosition = Object.entries(leaderboard)
      .map(([num, t]) => ({ code: driversMap.get(parseInt(num))?.code, position: t.position ?? 99 }))
      .filter((d) => d.code)
      .sort((a, b) => a.position - b.position)
      .slice(0, MAX_DEFAULT_VISIBLE)
      .map((d) => d.code as string);
    return new Set(byPosition);
  }, [leaderboard, driversMap]);

  const isVisible = (code: string) => (hiddenCodes ? !hiddenCodes.has(code) : defaultVisible.has(code));

  const toggleCode = (code: string) => {
    setHiddenCodes((prev) => {
      // First click seeds the hidden set from today's default-hidden drivers, so
      // toggling one driver doesn't suddenly reveal all the others too.
      const base = prev ?? new Set(driverCodes.filter((c) => !defaultVisible.has(c)));
      const next = new Set(base);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  if (chartData.length < 2) {
    return (
      <div className="glass-panel rounded-lg p-4 h-full flex flex-col items-center justify-center border border-white/5 text-white/30 text-center gap-2">
        <TrendingUp className="h-6 w-6 opacity-40" />
        <p className="text-xs font-titillium uppercase tracking-widest">
          Gap evolution appears once a lap completes
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col border border-white/5">
      <h2 className="text-sm font-bold tracking-widest text-f1-red uppercase flex items-center gap-2 mb-2 font-titillium shrink-0">
        <TrendingUp className="h-4 w-4" />
        Gap to Leader — Evolution
      </h2>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 12, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis
              dataKey="lap"
              stroke="#ffffff40"
              tick={{ fill: "#ffffff60", fontSize: 11 }}
              label={{ value: "LAP", position: "insideBottom", offset: -3, fill: "#ffffff40", fontSize: 10 }}
            />
            <YAxis
              stroke="#ffffff40"
              tick={{ fill: "#ffffff60", fontSize: 11 }}
              label={{ value: "GAP (s)", angle: -90, position: "insideLeft", fill: "#ffffff40", fontSize: 10 }}
            />
            <ReferenceLine y={0} stroke="#ffffff30" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{ backgroundColor: "#111118", border: "1px solid #ffffff20", borderRadius: "8px" }}
              itemStyle={{ fontFamily: "Titillium Web", fontWeight: "bold" }}
              labelFormatter={(lap) => `Lap ${lap}`}
            />
            <Legend
              onClick={(entry: any) => toggleCode(entry.dataKey as string)}
              wrapperStyle={{ fontFamily: "Titillium Web", paddingTop: "8px", cursor: "pointer" }}
            />
            {driverCodes.map((code) => {
              const driver = drivers.find((d) => d.code === code);
              return (
                <Line
                  key={code}
                  type="monotone"
                  dataKey={code}
                  stroke={driver?.team_color || "#ffffff"}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  hide={!isVisible(code)}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
