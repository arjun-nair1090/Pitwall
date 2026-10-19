"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, seriesDash } from "@/components/charts/chartTheme";
import { formatChance } from "@/lib/championship";
import { chartDrivers, mergeLaps, oddsRows, type ChartDriver, type OddsRow, type WinProbResult } from "@/lib/winprob";

export function ChanceTooltipContent({
  active,
  payload,
  drivers,
}: {
  active?: boolean;
  payload?: { payload: OddsRow }[];
  drivers: readonly ChartDriver[];
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const order = drivers.map((d) => ({ code: d.code, p: row[d.code] ?? 0 })).sort((a, b) => b.p - a.p);
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs tabular-nums shadow-lg">
      <p className="mb-1 font-semibold text-chalk">Lap {row.lap}</p>
      <ul role="list" className="flex flex-col gap-0.5">
        {order.map((e) => (
          <li key={e.code} className="flex justify-between gap-3 text-mute">
            <span>{e.code}</span>
            <span>{formatChance(e.p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Every contender's chance of winning, lap by lap. Safety-car laps are shaded, the selected lap has a
// vertical line, and clicking the chart selects the lap under the pointer.
export default function WinChart({ data, lap, onSelect }: { data: WinProbResult; lap: number; onSelect: (lap: number) => void }) {
  const drivers = useMemo(() => chartDrivers(data), [data]);
  const rows = useMemo(() => oddsRows(data, drivers.map((d) => d.code)), [data, drivers]);
  const spans = useMemo(() => mergeLaps(data.sc_laps), [data.sc_laps]);
  const total = data.total_laps;

  return (
    <div className="flex flex-col gap-3">
      <div style={{ height: 360 }} className="w-full" role="img" aria-label="Each driver's chance of winning, lap by lap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            onClick={(state) => {
              const label = Number(state?.activeLabel);
              if (Number.isFinite(label) && label >= 1) onSelect(label);
            }}
          >
            <CartesianGrid {...CHART.grid} />
            <XAxis type="number" dataKey="lap" domain={[1, Math.max(total, 2)]} allowDecimals={false} {...CHART.axis} />
            <YAxis type="number" domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} {...CHART.axis} />
            {spans.map(([from, to]) => (
              <ReferenceArea
                key={`sc-${from}`}
                x1={from - 0.5}
                x2={to + 0.5}
                ifOverflow="hidden"
                fill={CHART.tooltip.cursor.stroke}
                fillOpacity={0.18}
                stroke="none"
              />
            ))}
            <ReferenceLine x={lap} stroke={CHART.tooltip.cursor.stroke} strokeWidth={1.5} />
            <Tooltip cursor={CHART.tooltip.cursor} content={<ChanceTooltipContent drivers={drivers} />} />
            {drivers.map((d) => (
              <Line
                key={d.code}
                type="monotone"
                dataKey={d.code}
                stroke={d.color}
                strokeWidth={2}
                strokeDasharray={seriesDash(d.dashed ? 1 : 0)}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul role="list" aria-label="Drivers on the chart" className="flex flex-wrap gap-x-4 gap-y-1.5">
        {drivers.map((d) => (
          <li key={d.code} className="flex items-center gap-1.5 text-xs text-mute">
            <span
              aria-hidden
              className="w-5 shrink-0"
              style={{ borderTop: `2px ${d.dashed ? "dashed" : "solid"} ${d.color}` }}
            />
            {d.code}
          </li>
        ))}
      </ul>
    </div>
  );
}
