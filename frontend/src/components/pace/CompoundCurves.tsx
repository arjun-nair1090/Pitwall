"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/components/charts/chartTheme";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import { getCompoundStyle } from "@/lib/compounds";
import { formatDeg, type CompoundDegradation, type CurvePoint } from "@/lib/pace";

const NOTE =
  "Each point is the median, at that tyre age, of every stint of at least 5 clean laps, measured against that stint's own fresh-tyre pace, so a quicker driver doesn't skew the curve. Points can sit below zero when drivers push on new tyres. The wear rate is pooled within stints, so long stints count most.";

function CurveTooltip({ active, payload }: { active?: boolean; payload?: { payload: CurvePoint }[] }) {
  const point = active ? payload?.find((p) => p.payload.laps !== undefined)?.payload : undefined;
  if (!point) return null;
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs tabular-nums shadow-lg">
      <p className="mb-1 font-semibold text-chalk">Tyre life {point.tyre_life}</p>
      <p className="text-mute">Median <span className="ml-2 text-chalk">{`${point.loss < 0 ? "−" : "+"}${Math.abs(point.loss).toFixed(2)} s`}</span></p>
      <p className="text-mute">Laps <span className="ml-2 text-chalk">{point.laps}</span></p>
    </div>
  );
}

// How each compound wore across the whole field: the measured median at each tyre age, the pooled
// wear rate drawn through the origin, and the figures in a table underneath.
export default function CompoundCurves({ compounds }: { compounds: readonly CompoundDegradation[] }) {
  if (compounds.length === 0) {
    return <EmptyState title="Not enough long runs" description="No compound has a stint of at least 5 clean laps to measure wear from." />;
  }

  const columns: Column<CompoundDegradation>[] = [
    {
      key: "compound", header: "Compound",
      cell: (c) => {
        const style = getCompoundStyle(c.compound);
        return (
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-black leading-none text-chalk"
              style={{ borderColor: style.color }}
            >
              {style.letter}
            </span>
            {style.label}
          </span>
        );
      },
    },
    { key: "wear", header: "Wear", align: "right", cell: (c) => formatDeg(c.deg_per_lap) },
    { key: "stints", header: "Stints", align: "right", className: "text-mute", cell: (c) => c.stints },
    { key: "laps", header: "Laps", align: "right", className: "text-mute", cell: (c) => c.laps },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div style={{ height: 320 }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis
              type="number"
              dataKey="tyre_life"
              domain={[0, "dataMax"]}
              allowDecimals={false}
              label={{ value: "Tyre life (laps)", position: "insideBottom", offset: -10, fill: "#ACACBE", fontSize: 11 }}
              {...CHART.axis}
            />
            <YAxis
              type="number"
              dataKey="loss"
              width={56}
              tickFormatter={(v: number) => v.toFixed(1)}
              label={{ value: "Lap time against fresh-tyre pace (s)", angle: -90, position: "insideLeft", offset: 12, fill: "#ACACBE", fontSize: 11, style: { textAnchor: "middle" } }}
              {...CHART.axis}
            />
            <ReferenceLine y={0} stroke="#7C7C92" strokeDasharray="3 3" />
            <Tooltip cursor={CHART.tooltip.cursor} content={<CurveTooltip />} />
            {compounds.map((c) => (
              <Scatter key={`p${c.compound}`} data={c.curve} fill={getCompoundStyle(c.compound).color} isAnimationActive={false} />
            ))}
            {compounds.map((c) => {
              if (c.curve.length === 0) return null;
              const first = c.curve[0].tyre_life;
              const last = c.curve[c.curve.length - 1].tyre_life;
              return (
                <Line
                  key={`f${c.compound}`}
                  data={[{ tyre_life: first, loss: c.deg_per_lap * first }, { tyre_life: last, loss: c.deg_per_lap * last }]}
                  dataKey="loss"
                  stroke={getCompoundStyle(c.compound).color}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <DataTable columns={columns} rows={compounds} rowKey={(c) => c.compound} caption="Tyre wear by compound" dense />
      <p className="text-xs text-faint">{NOTE}</p>
    </div>
  );
}
