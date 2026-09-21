import { teamColor, UNKNOWN_TEAM_COLOR } from "@/lib/timing";

// Recharts takes literal colours, not CSS variables. These mirror
// src/design/tokens.css; chartTheme.test.ts fails if they drift.
export const CHART = {
  grid: { stroke: "#38384A", strokeDasharray: "2 4", vertical: false },
  axis: {
    stroke: "#38384A",
    tickLine: false,
    tick: { fill: "#ACACBE", fontSize: 11 },
  },
  tooltip: {
    contentStyle: {
      background: "#282836",
      border: "1px solid #38384A",
      borderRadius: 2,
      color: "#F0F0F5",
      fontSize: 12,
    },
    labelStyle: { color: "#ACACBE" },
    itemStyle: { color: "#F0F0F5" },
    cursor: { stroke: "#7C7C92", strokeWidth: 1 },
  },
  legend: { wrapperStyle: { color: "#ACACBE", fontSize: 12 } },
} as const;

const NEUTRAL_SERIES = ["#F0F0F5", "#ACACBE", "#7C7C92"] as const;

// Team colour when we know the team, otherwise a neutral grey by position.
export function seriesColor(team: string | null | undefined, index: number): string {
  const color = teamColor(team);
  return color === UNKNOWN_TEAM_COLOR ? NEUTRAL_SERIES[index % NEUTRAL_SERIES.length] : color;
}

// Teammates share a colour, so the second series is dashed.
export function seriesDash(index: number): string | undefined {
  return index % 2 === 1 ? "6 4" : undefined;
}
