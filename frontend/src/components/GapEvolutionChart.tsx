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
import { CHART, seriesColor, seriesDash } from "@/components/charts/chartTheme";
import EmptyState from "@/components/ui/EmptyState";
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
      <EmptyState
        icon={TrendingUp}
        title="No gap history yet"
        description="The chart appears once the first lap is complete."
        className="h-full"
      />
    );
  }

  // Teammates share a team colour, so the second car of a team is drawn dashed.
  const teamUse = new Map<string, number>();

  return (
    <div className="h-full p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 12, left: -12, bottom: 5 }}>
          <CartesianGrid {...CHART.grid} />
          <XAxis
            dataKey="lap"
            {...CHART.axis}
            label={{ value: "Lap", position: "insideBottom", offset: -3, fill: "#A6AEBB", fontSize: 11 }}
          />
          <YAxis
            {...CHART.axis}
            label={{ value: "Gap to leader (s)", angle: -90, position: "insideLeft", fill: "#A6AEBB", fontSize: 11 }}
          />
          <ReferenceLine y={0} stroke="#6C7789" strokeDasharray="3 3" />
          <Tooltip {...CHART.tooltip} labelFormatter={(lap) => `Lap ${lap}`} />
          <Legend {...CHART.legend} onClick={(entry: any) => toggleCode(entry.dataKey as string)} />
          {driverCodes.map((code, index) => {
            const driver = drivers.find((d) => d.code === code);
            const color = driver?.team_color || seriesColor(null, index);
            const nth = teamUse.get(color) ?? 0;
            teamUse.set(color, nth + 1);
            return (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                stroke={color}
                strokeDasharray={seriesDash(nth)}
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
  );
}
