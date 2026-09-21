import { teamColor, UNKNOWN_TEAM_COLOR } from "@/lib/timing";

// Recharts takes literal colours, not CSS variables. These mirror
// src/design/tokens.css; chartTheme.test.ts fails if they drift.
export const CHART = {
  grid: { stroke: "#2A303A", strokeDasharray: "2 4", vertical: false },
  axis: {
    stroke: "#2A303A",
    tickLine: false,
    tick: { fill: "#A6AEBB", fontSize: 11 },
  },
  tooltip: {
    contentStyle: {
      background: "#232832",
      border: "1px solid #2A303A",
      borderRadius: 6,
      color: "#E8EBEF",
      fontSize: 12,
    },
    labelStyle: { color: "#A6AEBB" },
    itemStyle: { color: "#E8EBEF" },
    cursor: { stroke: "#6C7789", strokeWidth: 1 },
  },
  legend: { wrapperStyle: { color: "#A6AEBB", fontSize: 12 } },
} as const;

const NEUTRAL_SERIES = ["#E8EBEF", "#A6AEBB", "#6C7789"] as const;

// Team colour when we know the team, otherwise a neutral grey by position.
export function seriesColor(team: string | null | undefined, index: number): string {
  const color = teamColor(team);
  return color === UNKNOWN_TEAM_COLOR ? NEUTRAL_SERIES[index % NEUTRAL_SERIES.length] : color;
}

// Teammates share a colour, so the second series is dashed.
export function seriesDash(index: number): string | undefined {
  return index % 2 === 1 ? "6 4" : undefined;
}
