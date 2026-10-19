"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, seriesColor, seriesDash } from "@/components/charts/chartTheme";
import { formatChance, type ChampionDriver, type HistoryPoint } from "@/lib/championship";

interface Styled {
  driver: ChampionDriver;
  color: string;
  dash: string | undefined;
}

// Only a driver who was ever a real chance gets a line. Lines follow the drivers list, and the
// second driver with a given team string gets the dashed line.
function chartedDrivers(history: readonly HistoryPoint[], drivers: readonly ChampionDriver[]): Styled[] {
  const seen = new Map<string, number>();
  const styled: Styled[] = [];
  drivers.forEach((driver, i) => {
    if (!history.some((h) => (h.odds[driver.code] ?? 0) >= 0.01)) return;
    const nth = seen.get(driver.team) ?? 0;
    seen.set(driver.team, nth + 1);
    styled.push({ driver, color: seriesColor(driver.team, i), dash: seriesDash(nth) });
  });
  return styled;
}

export function OddsTooltipContent({
  active,
  payload,
  drivers,
}: {
  active?: boolean;
  payload?: { payload: HistoryPoint }[];
  drivers: readonly ChampionDriver[];
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  const order = drivers
    .map((d) => ({ code: d.code, chance: point.odds[d.code] ?? 0 }))
    .sort((a, b) => b.chance - a.chance);
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs tabular-nums shadow-lg">
      <p className="mb-1 font-semibold text-chalk">{`After round ${point.round}: ${point.name}`}</p>
      <ul role="list" className="flex flex-col gap-0.5">
        {order.map((e) => (
          <li key={e.code} className="flex justify-between gap-4 text-mute">
            <span>{e.code}</span>
            <span className="text-chalk">{formatChance(e.chance)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// How each driver's title chance moved round by round, each point re-simulated with only the races
// run by then. The marks are the lines alone (no dots, no Scatter): in a line chart the axis tooltip
// would name the wrong point for a scatter.
export default function OddsHistory({ history, drivers }: { history: readonly HistoryPoint[]; drivers: readonly ChampionDriver[] }) {
  const styled = chartedDrivers(history, drivers);
  const charted = styled.map((s) => s.driver);
  const last = history.length > 0 ? history[history.length - 1].round : 1;
  const first = history.length > 0 ? history[0].round : 1;

  return (
    <div className="flex flex-col gap-4">
      <div style={{ height: 320 }} className="w-full" role="img" aria-label="Title chance of each driver after every round">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history as HistoryPoint[]} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis type="number" dataKey="round" domain={[first, Math.max(last, first + 1)]} allowDecimals={false} {...CHART.axis} />
            <YAxis
              type="number"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              width={44}
              {...CHART.axis}
            />
            <Tooltip cursor={CHART.tooltip.cursor} content={<OddsTooltipContent drivers={charted} />} />
            {styled.map(({ driver, color, dash }) => (
              <Line
                key={driver.code}
                type="monotone"
                dataKey={(h: HistoryPoint) => h.odds[driver.code] ?? 0}
                name={driver.code}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={dash}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            ))}
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
