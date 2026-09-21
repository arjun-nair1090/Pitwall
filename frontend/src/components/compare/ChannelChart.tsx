"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/components/charts/chartTheme";
import type { DuelRow, DuelStyle } from "@/lib/duel";

export interface ChartDef {
  id: string;
  label: string;
  unit: string;
  height: number;
  defaultOn: boolean;
  // Either a channel plotted for both drivers, or one derived series.
  channel?: "speed" | "throttle" | "brake" | "gear" | "rpm" | "drs" | "acceleration";
  single?: "gap" | "speedDiff";
  stepped?: boolean;
  domain?: [number | "auto", number | "auto"];
  ticks?: number[];
  format?: (value: number) => string;
  zeroLine?: boolean;
  caption?: (code1: string, code2: string) => string;
}

const onOff = (v: number) => (v >= 0.5 ? "On" : "Off");
const drs = (v: number) => (v >= 10 ? "Open" : "Closed");

export const CHART_DEFS: ChartDef[] = [
  { id: "speed", label: "Speed", unit: "km/h", height: 220, defaultOn: true, channel: "speed", domain: ["auto", "auto"] },
  {
    id: "gap", label: "Gap", unit: "s", height: 160, defaultOn: true, single: "gap", zeroLine: true, domain: ["auto", "auto"],
    format: (v) => v.toFixed(3),
    caption: (a, b) => `Above zero, ${a} was ahead; below zero, ${b} was.`,
  },
  { id: "throttle", label: "Throttle", unit: "%", height: 130, defaultOn: true, channel: "throttle", domain: [0, 100] },
  { id: "brake", label: "Brake", unit: "", height: 90, defaultOn: true, channel: "brake", stepped: true, domain: [0, 1], ticks: [0, 1], format: onOff },
  { id: "gear", label: "Gear", unit: "", height: 130, defaultOn: true, channel: "gear", stepped: true, domain: [1, 8], ticks: [1, 2, 3, 4, 5, 6, 7, 8] },
  { id: "rpm", label: "Engine revs", unit: "rpm", height: 130, defaultOn: false, channel: "rpm", domain: ["auto", "auto"] },
  { id: "drs", label: "DRS", unit: "", height: 90, defaultOn: false, channel: "drs", stepped: true, domain: [0, 14], ticks: [0, 12], format: drs },
  { id: "acceleration", label: "Acceleration", unit: "m/s²", height: 130, defaultOn: false, channel: "acceleration", domain: ["auto", "auto"], zeroLine: true },
  {
    id: "speedDiff", label: "Speed difference", unit: "km/h", height: 130, defaultOn: false, single: "speedDiff", zeroLine: true, domain: ["auto", "auto"],
    caption: (a) => `Above zero, ${a} was faster.`,
  },
];

const metres = (m: number) => `${(m / 1000).toFixed(1)} km`;

interface TooltipEntry { dataKey?: string | number; value?: number; color?: string; strokeDasharray?: string | number }

function ChartTooltip({
  active, payload, label, def, code1, code2, style,
}: { active?: boolean; payload?: TooltipEntry[]; label?: number; def: ChartDef; code1: string; code2: string; style: DuelStyle }) {
  if (!active || !payload?.length) return null;
  const show = (v: number | undefined) => (v === undefined ? "–" : def.format ? def.format(v) : `${Math.round(v * 10) / 10}${def.unit ? ` ${def.unit}` : ""}`);
  const rows = def.single
    ? [{ code: def.label, color: "#E8EBEF", dash: undefined as string | undefined, value: payload[0]?.value }]
    : [
        { code: code1, color: style.color1, dash: undefined as string | undefined, value: payload.find((p) => String(p.dataKey).startsWith("a_"))?.value },
        { code: code2, color: style.color2, dash: style.dash2, value: payload.find((p) => String(p.dataKey).startsWith("b_"))?.value },
      ];
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 tabular-nums text-mute">{label !== undefined ? metres(label) : ""}</p>
      {rows.map((r) => (
        <p key={r.code} className="flex items-center gap-2 tabular-nums text-chalk">
          <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={r.color} strokeWidth="3" strokeDasharray={r.dash} /></svg>
          <span className="text-mute">{r.code}</span>
          <span className="ml-auto pl-3 font-medium">{show(r.value)}</span>
        </p>
      ))}
    </div>
  );
}

interface ChannelChartProps {
  def: ChartDef;
  rows: readonly DuelRow[];
  code1: string;
  code2: string;
  style: DuelStyle;
  showDistance: boolean;
}

// One telemetry channel over the lap, both drivers on shared axes. All charts share a syncId, so
// hovering one moves the cursor on every other.
export default function ChannelChart({ def, rows, code1, code2, style, showDistance }: ChannelChartProps) {
  const line = (dataKey: string, stroke: string, dash?: string) => (
    <Line
      key={dataKey}
      dataKey={dataKey}
      type={def.stepped ? "stepAfter" : "monotone"}
      stroke={stroke}
      strokeDasharray={dash}
      strokeWidth={1.75}
      dot={false}
      isAnimationActive={false}
    />
  );

  return (
    <section aria-label={def.label} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 px-1">
        <h3 className="font-display text-xs font-bold uppercase tracking-[0.12em] text-chalk">{def.label}</h3>
        {def.unit && <span className="text-xs text-faint">{def.unit}</span>}
        {def.caption && <span className="text-xs text-mute">{def.caption(code1, code2)}</span>}
      </div>
      <div style={{ height: def.height + (showDistance ? 22 : 0) }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows as DuelRow[]} syncId="duel" margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis
              dataKey="distance"
              type="number"
              domain={[0, "dataMax"]}
              hide={!showDistance}
              tickFormatter={metres}
              {...CHART.axis}
              minTickGap={40}
            />
            <YAxis
              width={def.format ? 48 : 40}
              domain={def.domain ?? ["auto", "auto"]}
              ticks={def.ticks}
              tickFormatter={def.format ? (v: number) => def.format!(v) : undefined}
              allowDecimals={false}
              {...CHART.axis}
            />
            <Tooltip
              cursor={CHART.tooltip.cursor}
              content={<ChartTooltip def={def} code1={code1} code2={code2} style={style} />}
            />
            {def.zeroLine && <ReferenceLine y={0} stroke="#6C7789" strokeDasharray="3 3" />}
            {def.single
              ? line(def.single, "#E8EBEF")
              : [line(`a_${def.channel}`, style.color1), line(`b_${def.channel}`, style.color2, style.dash2)]}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
