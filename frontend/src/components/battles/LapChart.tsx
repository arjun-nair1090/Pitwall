"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, seriesColor, seriesDash } from "@/components/charts/chartTheme";
import Select from "@/components/ui/Select";
import { ordinal, type BattleDriver, type Overtake } from "@/lib/battles";

type LapRow = { lap: number } & Record<string, number | null>;

interface Styled {
  driver: BattleDriver;
  color: string;
  dash: string | undefined;
}

// The second driver with a given team string, in payload order, gets the dashed line.
function styleDrivers(drivers: readonly BattleDriver[]): Styled[] {
  const seen = new Map<string, number>();
  return drivers.map((driver, i) => {
    const nth = seen.get(driver.team) ?? 0;
    seen.set(driver.team, nth + 1);
    return { driver, color: driver.color || seriesColor(driver.team, i), dash: seriesDash(nth) };
  });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summary(d: BattleDriver): string {
  const start = d.grid === null ? "started from the pit lane" : `started ${ordinal(d.grid)}`;
  const finish = d.finish === null ? "did not finish" : `finished ${ordinal(d.finish)}`;
  return `${d.code}: ${start}, ${finish}, ${plural(d.made, "pass", "passes")} made, ${d.lost} lost`;
}

export function LapTooltipContent({
  active,
  payload,
  drivers,
  highlight,
}: {
  active?: boolean;
  payload?: { payload: LapRow }[];
  drivers: readonly BattleDriver[];
  highlight: string;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const order = drivers
    .map((d) => ({ code: d.code, position: row[d.code] }))
    .filter((e): e is { code: string; position: number } => typeof e.position === "number")
    .sort((a, b) => a.position - b.position);
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs tabular-nums shadow-lg">
      <p className="mb-1 font-semibold text-chalk">Lap {row.lap}</p>
      <ul role="list" className="flex flex-col gap-0.5">
        {order.map((e) => (
          <li key={e.code} className={e.code === highlight ? "flex gap-2 font-semibold text-chalk" : "flex gap-2 text-mute"}>
            <span className="w-5 text-right">{e.position}</span>
            <span>{e.code}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Every driver's race position, lap by lap. Picking a driver thickens their line, fades the rest
// and ringed-marks the laps where they made a pass. The marks are the highlighted line's own dots,
// not a Scatter: in a line chart the axis tooltip matches a scatter by index and names the wrong point.
export default function LapChart({
  drivers,
  overtakes,
  totalLaps,
}: {
  drivers: readonly BattleDriver[];
  overtakes: readonly Overtake[];
  totalLaps: number;
}) {
  const [highlight, setHighlight] = useState("");
  const styled = styleDrivers(drivers);
  const chosen = drivers.find((d) => d.code === highlight);
  const passLaps = new Set(overtakes.filter((o) => o.driver === highlight).map((o) => o.lap));

  const rows: LapRow[] = Array.from({ length: totalLaps }, (_, i) => {
    const row: LapRow = { lap: i + 1 };
    for (const d of drivers) row[d.code] = d.positions[i] ?? null;
    return row;
  });

  return (
    <div className="flex flex-col gap-4">
      <Select label="Highlight" value={highlight} onChange={(e) => setHighlight(e.target.value)} className="max-w-xs">
        <option value="">Nobody</option>
        {drivers.map((d) => <option key={d.code} value={d.code}>{`${d.name} (${d.code})`}</option>)}
      </Select>
      {chosen && <p data-testid="lap-chart-summary" className="text-sm text-mute">{summary(chosen)}</p>}

      <div style={{ height: 420 }} className="w-full" role="img" aria-label="Race position of every driver, lap by lap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis type="number" dataKey="lap" domain={[1, Math.max(totalLaps, 2)]} allowDecimals={false} {...CHART.axis} />
            <YAxis
              type="number"
              reversed
              domain={[1, Math.max(drivers.length, 2)]}
              allowDecimals={false}
              interval={0}
              ticks={Array.from({ length: drivers.length }, (_, i) => i + 1)}
              width={32}
              {...CHART.axis}
            />
            <Tooltip cursor={CHART.tooltip.cursor} content={<LapTooltipContent drivers={drivers} highlight={highlight} />} />
            {styled.map(({ driver, color, dash }) => {
              const on = driver.code === highlight;
              return (
                <Line
                  key={driver.code}
                  type="stepAfter"
                  dataKey={driver.code}
                  stroke={color}
                  strokeWidth={on ? 3 : 1.5}
                  strokeOpacity={highlight === "" || on ? 1 : 0.2}
                  strokeDasharray={dash}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={
                    on
                      ? (p: { cx?: number; cy?: number; payload?: LapRow; index?: number }) => {
                          const lap = p.payload?.lap;
                          const key = `pass-${driver.code}-${p.index ?? lap}`;
                          if (lap === undefined || !passLaps.has(lap) || p.cx === undefined || p.cy === undefined) return <g key={key} />;
                          return <circle key={key} data-pass-dot={lap} cx={p.cx} cy={p.cy} r={5} fill={CHART.tooltip.contentStyle.background} stroke={color} strokeWidth={2.5} />;
                        }
                      : false
                  }
                  activeDot={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul role="list" aria-label="Drivers on the chart" className="flex flex-wrap gap-x-4 gap-y-1.5">
        {styled.map(({ driver, color, dash }) => (
          <li key={driver.code} className="flex items-center gap-1.5 text-xs text-mute">
            <span
              aria-hidden
              data-swatch
              data-dashed={dash ? "true" : "false"}
              className="h-0 w-5 shrink-0 border-t-2"
              style={{ borderTopColor: color, borderTopStyle: dash ? "dashed" : "solid", backgroundColor: color, height: dash ? 0 : 2 }}
            />
            {driver.code}
          </li>
        ))}
      </ul>
    </div>
  );
}
