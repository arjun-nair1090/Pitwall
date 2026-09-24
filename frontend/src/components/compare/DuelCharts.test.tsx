import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import DuelCharts from "./DuelCharts";
import { buildDuelRows, duelStyle, type TelemetryPoint } from "@/lib/duel";

// jsdom has no layout, so Recharts would see a zero-size container and draw nothing. A fixed size
// lets the real chart render, which is what proves our axis and line props are valid.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 200 }),
  };
});

const lap = (speed: number): TelemetryPoint[] =>
  Array.from({ length: 30 }, (_, i) => ({
    distance: i * 100, speed: speed + i, throttle: 100, brake: 0, gear: 5, rpm: 11000, drs: 0, time: i * 2, x: i, y: 0, acceleration: 0,
  }));

const rows = buildDuelRows(lap(280), lap(275), 50);
const props = { rows, code1: "VER", code2: "NOR", style: duelStyle("#3671C6", "#FF8000") };

describe("DuelCharts", () => {
  it("starts with the channels that matter most for a comparison", () => {
    render(<DuelCharts {...props} />);
    for (const name of ["Speed", "Gap", "Throttle", "Brake", "Gear"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Engine revs" })).not.toBeInTheDocument();
  });

  it("adds and removes a channel from the toggle chips", async () => {
    render(<DuelCharts {...props} />);
    const revs = screen.getByRole("button", { name: "Engine revs" });
    expect(revs).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(revs);
    expect(screen.getByRole("heading", { name: "Engine revs" })).toBeInTheDocument();
    expect(revs).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(revs);
    expect(screen.queryByRole("heading", { name: "Engine revs" })).not.toBeInTheDocument();
  });

  it("offers every channel as a toggle, with the default ones pressed", () => {
    render(<DuelCharts {...props} />);
    const group = screen.getByRole("group", { name: "Channels" });
    expect(group.querySelectorAll("button")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Speed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Acceleration" })).toHaveAttribute("aria-pressed", "false");
  });

  it("explains how to read the gap chart with the drivers' names", () => {
    render(<DuelCharts {...props} />);
    expect(screen.getByText(/Above zero, VER was ahead; below zero, NOR was\./)).toBeInTheDocument();
  });

  it("keys the lines to the drivers, dashing the second when they're teammates", () => {
    const { container } = render(<DuelCharts {...props} style={duelStyle("#3671C6", "#3671C6")} code2="PER" />);
    const key = screen.getByRole("list", { name: "Line key" });
    expect(key).toHaveTextContent("VER");
    expect(key).toHaveTextContent("PER");
    expect(container.querySelector('[role="list"] line[stroke-dasharray]')).not.toBeNull();
  });

  it("never lets the last channel be switched off, so there is always something to see", async () => {
    render(<DuelCharts {...props} />);
    for (const name of ["Gap", "Throttle", "Brake", "Gear", "Speed"]) {
      await userEvent.click(screen.getByRole("button", { name }));
    }
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Speed" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when there is nothing to plot", () => {
    render(<DuelCharts {...props} rows={[]} />);
    expect(screen.getByText(/no telemetry to chart/i)).toBeInTheDocument();
  });
});

describe("DuelCharts rendering", () => {
  it("draws both drivers' lines for each visible chart", () => {
    const { container } = render(<DuelCharts {...props} />);
    // speed, throttle, brake and gear plot two series; the gap plots one: 4*2 + 1 = 9 lines
    expect(container.querySelectorAll(".recharts-line").length).toBe(9);
  });

  it("dashes the second driver's lines for teammates", () => {
    const { container } = render(<DuelCharts {...props} style={duelStyle("#3671C6", "#3671C6")} />);
    const dashed = container.querySelectorAll(".recharts-line path[stroke-dasharray]");
    expect(dashed.length).toBe(4);
  });
});
