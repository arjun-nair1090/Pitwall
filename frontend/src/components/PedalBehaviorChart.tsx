import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { CHART } from '@/components/charts/chartTheme';

export interface DriverBehavior {
  driver_code: string;
  color: string;
  throttle_pct: number;
  brake_pct: number;
  both_pct: number;
  coast_pct: number;
  lap_time: number;
}

interface PedalBehaviorChartProps {
  data: DriverBehavior[];
}

// The four pedal states are categories, not rankings, so they get fixed colours; the legend
// names each one so colour is never the only cue.
const STATES = [
  { key: 'throttle_pct', name: 'Throttle only', fill: '#E8EBEF' },
  { key: 'brake_pct', name: 'Brake only', fill: '#E10600' },
  { key: 'both_pct', name: 'Trail braking (both)', fill: '#B57BFF' },
  { key: 'coast_pct', name: 'Coasting (neither)', fill: '#6C7789' },
] as const;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-panel border border-gantry bg-raised p-3">
        <p className="mb-2 font-semibold text-chalk">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} className="text-sm tabular-nums text-mute">
            <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: entry.color }} />
            {entry.name}: <span className="text-chalk">{entry.value.toFixed(1)}%</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function PedalBehaviorChart({ data }: PedalBehaviorChartProps) {
  if (!data || data.length === 0) return null;

  return (
    <div className="flex h-[500px] w-full flex-col">
      <p className="mb-4 text-sm text-mute">Share of the fastest lap spent in each pedal state.</p>

      <div className="relative w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} barSize={40}>
            <CartesianGrid {...CHART.grid} />
            <XAxis
              dataKey="driver_code"
              {...CHART.axis}
              tick={{ fill: '#E8EBEF', fontSize: 14, fontWeight: 600 }}
              axisLine={false}
            />
            <YAxis
              {...CHART.axis}
              domain={[0, 100]}
              tickFormatter={(val) => `${val}%`}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#232832' }} />
            <Legend {...CHART.legend} />

            {STATES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.fill} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
