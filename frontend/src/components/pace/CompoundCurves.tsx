"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/components/charts/chartTheme";
import CompoundBadge from "@/components/CompoundBadge";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import { getCompoundStyle } from "@/lib/compounds";
import { formatDeg, type CompoundDegradation, type CurvePoint } from "@/lib/pace";

const NOTE =
  "Each point is the median, at that tyre age, of every stint of at least 5 clean laps, measured against that stint's own fresh-tyre pace, so a quicker driver doesn't skew the curve. Points can sit below zero when drivers push on new tyres. The wear rate is the median of the stints' own rates. Colours match the table. In a mixed-weather race, intermediate and wet laps rarely count as clean, and a change in conditions shows up as wear.";

type CompoundPoint = CurvePoint & { compound: string };

function CurveTooltip({ active, payload }: { active?: boolean; payload?: { payload: CompoundPoint }[] }) {
  const point = active ? payload?.find((p) => p.payload.compound !== undefined)?.payload : undefined;
  if (!point) return null;
  const loss = `${point.loss < 0 ? "−" : "+"}${Math.abs(point.loss).toFixed(2)} s`;
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs tabular-nums shadow-lg">
      <p className="text-mute">
        <span className="font-semibold text-chalk">{getCompoundStyle(point.compound).label}</span>
        {` · tyre life ${point.tyre_life} · ${loss} · ${point.laps} laps`}
      </p>
    </div>
  );
}

// How each compound wore across the whole field: the measured median at each tyre age, the typical
// stint's wear rate drawn through the origin, and the figures in a table underneath.
export default function CompoundCurves({ compounds }: { compounds: readonly CompoundDegradation[] }) {
  if (compounds.length === 0) {
    return <EmptyState title="Not enough long runs" description="No compound has a stint of at least 5 clean laps to measure wear from." />;
  }

  const columns: Column<CompoundDegradation>[] = [
    {
      key: "compound", header: "Compound",
      cell: (c) => <CompoundBadge compound={c.compound} showLabel />,
    },
    { key: "wear", header: "Wear", align: "right", cell: (c) => formatDeg(c.deg_per_lap) },
    { key: "stints", header: "Stints", align: "right", className: "text-mute", cell: (c) => c.stints },
    { key: "laps", header: "Laps", align: "right", className: "text-mute", cell: (c) => c.laps },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{ height: 320 }}
        className="w-full"
        role="img"
        aria-label="Lap time against fresh-tyre pace by tyre age, for each compound"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis
              type="number"
              dataKey="tyre_life"
              domain={[0, "dataMax"]}
              allowDecimals={false}
              label={{ value: "Tyre life (laps)", position: "insideBottom", offset: -10, fill: CHART.axis.tick.fill, fontSize: 11 }}
              {...CHART.axis}
            />
            <YAxis
              type="number"
              dataKey="loss"
              width={56}
              tickFormatter={(v: number) => v.toFixed(1)}
              label={{ value: "Lap time against fresh-tyre pace (s)", angle: -90, position: "insideLeft", offset: 12, fill: CHART.axis.tick.fill, fontSize: 11, style: { textAnchor: "middle" } }}
              {...CHART.axis}
            />
            <ReferenceLine y={0} stroke={CHART.tooltip.cursor.stroke} strokeDasharray="3 3" />
            <Tooltip cursor={CHART.tooltip.cursor} content={<CurveTooltip />} />
            {compounds.map((c) => (
              <Scatter
                key={`p${c.compound}`}
                data={c.curve.map((p): CompoundPoint => ({ ...p, compound: c.compound }))}
                fill={getCompoundStyle(c.compound).color}
                isAnimationActive={false}
              />
            ))}
            {compounds.map((c) => {
              if (c.curve.length === 0) return null;
              const first = c.curve[0].tyre_life;
              const last = c.curve[c.curve.length - 1].tyre_life;
              return (
                <ReferenceLine
                  key={`f${c.compound}`}
                  segment={[{ x: first, y: c.deg_per_lap * first }, { x: last, y: c.deg_per_lap * last }]}
                  stroke={getCompoundStyle(c.compound).color}
                  strokeDasharray="6 4"
                  ifOverflow="extendDomain"
                />
              );
            })}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <DataTable columns={columns} rows={compounds} rowKey={(c) => c.compound} caption="Tyre wear by compound" dense />
      <p className="text-xs text-faint">{NOTE}</p>
    </div>
  );
}
