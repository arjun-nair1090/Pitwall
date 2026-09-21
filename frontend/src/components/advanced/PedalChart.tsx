"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/components/charts/chartTheme";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import Tabs, { tabPanelProps } from "@/components/ui/Tabs";
import { formatShare, PEDAL_STATES, sortByState, type PedalKey, type PedalRow } from "@/lib/pedals";
import { formatLapTime } from "@/lib/timing";

type View = "all" | PedalKey;
const TABS = [{ id: "all", label: "All states" }, ...PEDAL_STATES.map((s) => ({ id: s.key, label: s.label }))];
const ROW_HEIGHT = 26;

function BarTooltip({ active, payload }: { active?: boolean; payload?: { payload: PedalRow }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-control border border-gantry bg-raised px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-chalk">{r.name} <span className="font-normal text-mute">{r.team}</span></p>
      {PEDAL_STATES.map((s) => (
        <p key={s.key} className="flex items-center gap-2 tabular-nums text-mute">
          <span aria-hidden className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.fill }} />
          {s.label}
          <span className="ml-auto pl-4 text-chalk">{formatShare(r[s.key])}</span>
        </p>
      ))}
    </div>
  );
}

// Every driver's pedal use over their fastest lap. "All states" shows the whole split; picking one
// state ranks the drivers by it on an axis scaled to that state, so real differences are visible
// (the four states stacked to 100% hide them). The table underneath gives the exact numbers.
export default function PedalChart({ rows }: { rows: readonly PedalRow[] }) {
  const [view, setView] = useState<View>("all");
  const key: PedalKey | null = view === "all" ? null : view;
  const sorted = useMemo(() => sortByState(rows, key), [rows, key]);

  if (rows.length === 0) {
    return <EmptyState title="No pedal data" description="No driver in this session has a timed lap with telemetry." />;
  }

  const state = PEDAL_STATES.find((s) => s.key === key);
  const columns: Column<PedalRow>[] = [
    { key: "rank", header: "#", className: "w-10 text-mute", cell: (r) => sorted.indexOf(r) + 1 },
    {
      key: "driver",
      header: "Driver",
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-semibold">{r.name}</span>
          <span className="text-xs text-faint">{r.driver_code}</span>
        </span>
      ),
    },
    { key: "team", header: "Team", className: "text-mute", cell: (r) => r.team },
    { key: "lap", header: "Fastest lap", align: "right", cell: (r) => formatLapTime(r.lap_time) },
    ...PEDAL_STATES.map<Column<PedalRow>>((s) => ({
      key: s.key,
      header: s.label,
      align: "right",
      className: s.key === key ? "font-semibold text-chalk" : "text-mute",
      cell: (r) => formatShare(r[s.key]),
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <Tabs idBase="pedal" label="Pedal state" value={view} onChange={(id) => setView(id as View)} tabs={TABS} />
      <div {...tabPanelProps("pedal", view)} className="flex flex-col gap-3">
        <p className="text-sm text-mute">
          {state
            ? <>{state.meaning} Drivers are ranked by how much of their fastest lap they spent like this.</>
            : "How each driver split their fastest lap between the four pedal states. Drivers are ordered by lap time."}
        </p>
        <div style={{ height: sorted.length * ROW_HEIGHT + 56 }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sorted as PedalRow[]} layout="vertical" margin={{ top: 4, right: state ? 56 : 16, bottom: 4, left: 0 }} barCategoryGap={4}>
              <CartesianGrid {...CHART.grid} horizontal={false} vertical />
              <XAxis
                type="number"
                domain={state ? [0, "dataMax"] : [0, 100]}
                ticks={state ? undefined : [0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${Math.round(v)}%`}
                {...CHART.axis}
              />
              <YAxis type="category" dataKey="driver_code" width={44} tickLine={false} axisLine={false} tick={{ fill: "#E8EBEF", fontSize: 12, fontWeight: 600 }} interval={0} />
              <Tooltip cursor={{ fill: "#232832" }} content={<BarTooltip />} />
              {state ? (
                <Bar dataKey={state.key} isAnimationActive={false} radius={[0, 3, 3, 0]}>
                  {sorted.map((r) => <Cell key={r.driver_code} fill={r.color} />)}
                  <LabelList dataKey={state.key} position="right" formatter={(label: unknown) => formatShare(Number(label))} fill="#A6AEBB" fontSize={11} />
                </Bar>
              ) : (
                PEDAL_STATES.map((s) => <Bar key={s.key} dataKey={s.key} stackId="pedals" fill={s.fill} isAnimationActive={false} />)
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <ul role="list" aria-label="What the pedal states mean" className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {PEDAL_STATES.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-sm">
              <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.fill }} />
              <span>
                <span className="font-medium text-chalk">{s.label}</span>
                <span className="block text-xs text-mute">{s.meaning}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <DataTable caption="Pedal behaviour by driver" columns={columns} rows={sorted} rowKey={(r) => r.driver_code} accent={(r) => r.color} dense />
    </div>
  );
}
