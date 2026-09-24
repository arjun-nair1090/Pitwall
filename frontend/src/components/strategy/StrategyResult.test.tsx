import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StrategyResult from "./StrategyResult";
import type { SimulationResult } from "@/lib/strategy";

const result = (over: Partial<SimulationResult> = {}): SimulationResult => ({
  predicted_total_seconds: 4818.3,
  predicted_avg_lap_seconds: 109.507,
  num_pit_stops: 1,
  pit_loss_seconds_used: 18.3,
  total_laps: 44,
  stints: [
    { compound: "MEDIUM", laps: 20, start_lap: 1, end_lap: 20, seconds: 2210.2, avg_lap_seconds: 110.51 },
    { compound: "HARD", laps: 24, start_lap: 21, end_lap: 44, seconds: 2591.8, avg_lap_seconds: 107.99 },
  ],
  compound_stats: {
    MEDIUM: { base_pace: 110.67, deg_rate: 0.075, fuel_rate: -0.093, sample_size: 317 },
    HARD: { base_pace: 110.2, deg_rate: 0.061, fuel_rate: -0.093, sample_size: 377 },
    SOFT: { base_pace: 110.9, deg_rate: 0.25, fuel_rate: -0.093, sample_size: 2 },
  },
  ...over,
});

describe("StrategyResult", () => {
  it("shows the predicted race time, average lap and pit stops", () => {
    render(<StrategyResult result={result()} />);
    expect(screen.getByText("1:20:18.300")).toBeInTheDocument();
    expect(screen.getByText("1:49.507")).toBeInTheDocument();
    expect(screen.getByText("1 stop")).toBeInTheDocument();
    expect(screen.getByText(/about 18\.3 s lost in the pits each time/i)).toBeInTheDocument();
  });

  it("says 'No stops' for a one-stint plan", () => {
    render(<StrategyResult result={result({ num_pit_stops: 0 })} />);
    expect(screen.getByText("No stops")).toBeInTheDocument();
  });

  it("breaks the race down stint by stint", () => {
    render(<StrategyResult result={result()} />);
    const table = screen.getByRole("table", { name: /stint breakdown/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Laps 1 to 20")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Medium")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Laps 21 to 44")).toBeInTheDocument();
    expect(within(rows[1]).getByText("1:47.990")).toBeInTheDocument();
  });

  it("shows what the model learned about each tyre, and flags one it had little data for", () => {
    render(<StrategyResult result={result()} />);
    const table = screen.getByRole("table", { name: /how the model sees each tyre/i });
    expect(within(table).getByText("+0.075 s")).toBeInTheDocument();
    expect(within(table).getByText("317")).toBeInTheDocument();
    expect(within(table).getByText(/few laps: default wear/i)).toBeInTheDocument();
  });

  it("explains fuel burn-off in plain words", () => {
    render(<StrategyResult result={result()} />);
    expect(screen.getByText(/about 0\.093 s quicker every lap as fuel burns off/i)).toBeInTheDocument();
  });

  it("has no driver comparison unless one was asked for", () => {
    render(<StrategyResult result={result()} />);
    expect(screen.queryByRole("table", { name: /compared with/i })).not.toBeInTheDocument();
  });

  describe("compared with a driver", () => {
    const driver = { code: "VER", name: "Max Verstappen" };
    const baseline = result({ predicted_total_seconds: 4821.5 });
    const compared = result({ actual_driver_total_seconds: 4806.5, delta_seconds: 11.8 });

    it("judges the plan against the driver's real strategy through the same model", () => {
      render(<StrategyResult result={compared} baseline={baseline} driver={driver} />);
      expect(screen.getByText(/Your plan is 3\.2 s faster than VER's real strategy/)).toBeInTheDocument();
    });

    it("also compares with the real race, and is honest about the model's own error", () => {
      render(<StrategyResult result={compared} baseline={baseline} driver={driver} />);
      const table = screen.getByRole("table", { name: /compared with Max Verstappen/i });
      expect(within(table).getByText("1:20:06.500")).toBeInTheDocument();   // actual
      expect(within(table).getByText("1:20:21.500")).toBeInTheDocument();   // model's estimate of their strategy
      expect(screen.getByText(/the model was 15\.0 s out on VER's real strategy/i)).toBeInTheDocument();
    });

    it("says slower when the plan is slower", () => {
      render(<StrategyResult result={result({ predicted_total_seconds: 4830 })} baseline={baseline} driver={driver} />);
      expect(screen.getByText(/Your plan is 8\.5 s slower than VER's real strategy/)).toBeInTheDocument();
    });

    it("says so when the plan and the real strategy tie", () => {
      render(<StrategyResult result={result({ predicted_total_seconds: 4821.5 })} baseline={baseline} driver={driver} />);
      expect(screen.getByText(/exactly as fast as VER's real strategy/i)).toBeInTheDocument();
    });

    it("still compares with the real race when the strategy can't be re-run", () => {
      render(<StrategyResult result={compared} baseline={null} driver={driver} />);
      expect(screen.getByText(/11\.8 s slower than VER's real race/i)).toBeInTheDocument();
    });
  });
});
