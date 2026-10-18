"use client";

import { useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/components/charts/chartTheme";
import EmptyState from "@/components/ui/EmptyState";
import Select from "@/components/ui/Select";
import { getCompoundStyle } from "@/lib/compounds";
import { formatDeg, type PaceDriver, type PaceLap, type PaceStint } from "@/lib/pace";
import { formatLapTime } from "@/lib/timing";

function legendText(stint: PaceStint): string {
  const style = getCompoundStyle(stint.compound);
  const head = `Stint ${stint.stint} · ${style.label} · laps ${stint.start_lap}–${stint.end_lap}`;
  if (stint.laps.length === 0) return `${head} · no clean laps`;
  return `${head} · ${stint.deg_per_lap === null ? "too few laps for a slope" : formatDeg(stint.deg_per_lap)}`;
}

function LapTooltip({ active, payload }: { active?: boolean; payload?: { payload: PaceLap }[] }) {
  const lap = active ? payload?.find((p) => p.payload.corrected !== undefined)?.payload : undefined;
  if (!lap) return null;
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs tabular-nums shadow-lg">
      <p className="mb-1 font-semibold text-chalk">Lap {lap.lap}</p>
      <p className="text-mute">Corrected <span className="ml-2 text-chalk">{formatLapTime(lap.corrected)}</span></p>
      <p className="text-mute">Raw <span className="ml-2 text-chalk">{formatLapTime(lap.time)}</span></p>
      <p className="text-mute">Tyre life <span className="ml-2 text-chalk">{lap.tyre_life ?? "—"}</span></p>
    </div>
  );
}

// One driver's clean laps, fuel-corrected, coloured by compound, with each stint's fitted wear line.
export default function StintChart({ drivers }: { drivers: readonly PaceDriver[] }) {
  const candidates = drivers.filter((d) => d.stints.some((s) => s.laps.length > 0));
  const [code, setCode] = useState<string | null>(null);

  if (candidates.length === 0) {
    return <EmptyState title="No clean laps" description="No driver in this session has a clean lap to chart." />;
  }

  const driver = candidates.find((d) => d.code === code) ?? candidates[0];
  const lastLap = Math.max(...driver.stints.map((s) => s.end_lap));

  return (
    <div className="flex flex-col gap-4">
      <Select label="Driver" value={driver.code} onChange={(e) => setCode(e.target.value)} className="max-w-xs">
        {candidates.map((d) => <option key={d.code} value={d.code}>{`${d.name} (${d.code})`}</option>)}
      </Select>

      <div style={{ height: 320 }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis type="number" dataKey="lap" domain={[1, Math.max(lastLap, 2)]} allowDecimals={false} {...CHART.axis} />
            <YAxis
              type="number"
              dataKey="corrected"
              domain={["dataMin - 0.3", "dataMax + 0.3"]}
              tickFormatter={(v: number) => formatLapTime(v)}
              width={72}
              {...CHART.axis}
            />
            <Tooltip cursor={CHART.tooltip.cursor} content={<LapTooltip />} />
            {driver.stints.map((s) => (
              <Scatter key={`p${s.stint}`} data={s.laps} fill={getCompoundStyle(s.compound).color} isAnimationActive={false} />
            ))}
            {driver.stints.map((s) =>
              s.fit ? (
                <Line
                  key={`f${s.stint}`}
                  data={[{ lap: s.fit.from.lap, corrected: s.fit.from.time }, { lap: s.fit.to.lap, corrected: s.fit.to.time }]}
                  dataKey="corrected"
                  stroke={getCompoundStyle(s.compound).color}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              ) : null,
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ul role="list" aria-label="Stints" className="flex flex-col gap-1.5">
        {driver.stints.map((s) => (
          <li key={s.stint} className="flex items-center gap-2 text-sm text-mute">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: getCompoundStyle(s.compound).color }} />
            {legendText(s)}
          </li>
        ))}
      </ul>
    </div>
  );
}
