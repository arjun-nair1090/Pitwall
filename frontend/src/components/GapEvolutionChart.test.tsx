import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useF1Store } from "@/store/useTelemetryStore";
import GapEvolutionChart from "./GapEvolutionChart";

beforeEach(() => {
  useF1Store.setState({ gapHistory: [], drivers: [], leaderboard: {}, activeSession: null } as any);
});

describe("GapEvolutionChart", () => {
  it("waits for the first lap while a session is live", () => {
    useF1Store.setState({ activeSession: { session_key: 11396, live: true } } as any);
    render(<GapEvolutionChart />);
    expect(screen.getByText("The chart appears once the first lap is complete.")).toBeInTheDocument();
  });

  it("says the chart only builds during a live session when none is running", () => {
    useF1Store.setState({ activeSession: { session_key: 11388, live: false } } as any);
    render(<GapEvolutionChart />);
    expect(screen.getByText("No session is live")).toBeInTheDocument();
    expect(screen.getByText("The chart builds up lap by lap while a session is running.")).toBeInTheDocument();
  });
});
