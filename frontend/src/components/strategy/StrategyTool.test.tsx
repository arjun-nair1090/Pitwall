import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StrategyTool from "./StrategyTool";
import type { SessionDriver } from "@/hooks/useRaceData";
import type { Race } from "@/lib/season";
import type { SimulationResult } from "@/lib/strategy";

vi.mock("axios");
const post = vi.mocked(axios.post);

const sessionInfo = vi.fn();
vi.mock("@/hooks/useRaceData", () => ({
  useSeasonRaces: () => ({ status: "ready", data: [{ round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["R"] } satisfies Race], retry: vi.fn() }),
  useSessionInfo: (...args: unknown[]) => sessionInfo(...args),
}));

const drv = (code: string, name: string, position: number, over: Partial<SessionDriver> = {}): SessionDriver => ({
  code, name, team: "Team", color: "#3671C6", position, status: "Finished", laps: 44, fastest_lap: 30, fastest_time: 106,
  stints: [{ compound: "MEDIUM", laps: 20 }, { compound: "HARD", laps: 24 }], ...over,
});
const info = {
  year: 2024, round: 14, event_name: "Belgian Grand Prix", session: "R", total_laps: 44,
  drivers: [
    drv("HAM", "Lewis Hamilton", 1, { stints: [{ compound: "MEDIUM", laps: 11 }, { compound: "HARD", laps: 33 }] }),
    drv("VER", "Max Verstappen", 3),
    drv("ALO", "Fernando Alonso", 19, { laps: 12, status: "Engine", stints: [{ compound: "HARD", laps: 12 }] }),
  ],
};
const ready = (data: unknown) => ({ status: "ready", data, retry: vi.fn() });

const simulation = (over: Partial<SimulationResult> = {}): SimulationResult => ({
  predicted_total_seconds: 4818.3, predicted_avg_lap_seconds: 109.5, num_pit_stops: 1, pit_loss_seconds_used: 18.3, total_laps: 44,
  stints: [{ compound: "MEDIUM", laps: 22, start_lap: 1, end_lap: 22, seconds: 2400, avg_lap_seconds: 109 }, { compound: "HARD", laps: 22, start_lap: 23, end_lap: 44, seconds: 2400, avg_lap_seconds: 109 }],
  compound_stats: { MEDIUM: { base_pace: 110, deg_rate: 0.07, fuel_rate: -0.09, sample_size: 300 }, HARD: { base_pace: 110, deg_rate: 0.06, fuel_rate: -0.09, sample_size: 300 } },
  ...over,
});

const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: simulation() });
  sessionInfo.mockReset().mockReturnValue(ready(info));
});

describe("StrategyTool", () => {
  it("states the race distance and opens on a sensible one-stop plan, already simulated", async () => {
    render(<StrategyTool initial={initial} />);
    expect(screen.getAllByText("44 laps").length).toBeGreaterThan(0);
    expect(screen.getByText("All 44 laps planned.")).toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/strategy/simulate", {
      year: 2024, round: 14, session: "Race",
      stints: [{ compound: "MEDIUM", laps: 22 }, { compound: "HARD", laps: 22 }],
    });
    expect(await screen.findByText("1:20:18.300")).toBeInTheDocument();
  });

  it("holds off re-running until asked, and says the plan changed", async () => {
    render(<StrategyTool initial={initial} />);
    await screen.findByText("1:20:18.300");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Stint 1 tyre" })).getByRole("radio", { name: /soft/i }));
    expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Update simulation" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toMatchObject({ stints: [{ compound: "SOFT", laps: 22 }, { compound: "HARD", laps: 22 }] });
  });

  it("won't simulate a plan that doesn't cover the race, and says how many laps are missing", async () => {
    render(<StrategyTool initial={initial} />);
    await screen.findByText("1:20:18.300");
    fireEvent.change(screen.getByLabelText("Stint 2 laps"), { target: { value: "10" } });
    expect(screen.getByText("12 laps left to plan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /simulation/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Use the 12 unplanned laps on stint 2" }));
    expect(screen.getByRole("button", { name: /simulation/i })).toBeEnabled();
  });

  it("lists drivers, and explains why one can't be compared with", () => {
    render(<StrategyTool initial={initial} />);
    const options = within(screen.getByLabelText("Compare with a driver's real race")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "No comparison",
      "HAM Lewis Hamilton",
      "VER Max Verstappen",
      "ALO Fernando Alonso (Retired (Engine) after 12 of 44 laps)",
    ]);
    expect(options[3]).toBeDisabled();
    expect(options[1]).toBeEnabled();
  });

  it("loads a driver's real strategy into the planner", async () => {
    render(<StrategyTool initial={initial} />);
    await userEvent.selectOptions(screen.getByLabelText("Compare with a driver's real race"), "HAM");
    await userEvent.click(screen.getByRole("button", { name: "Use HAM's strategy" }));
    expect((screen.getByLabelText("Stint 1 laps") as HTMLInputElement).value).toBe("11");
    expect((screen.getByLabelText("Stint 2 laps") as HTMLInputElement).value).toBe("33");
  });

  it("compares with a driver by running their real strategy through the same model too", async () => {
    post.mockImplementation(async (_url, body: any) => ({
      data: body.driver_code
        ? simulation({ predicted_total_seconds: 4818.3, actual_driver_total_seconds: 4806.5, delta_seconds: 11.8 })
        : simulation({ predicted_total_seconds: 4821.5 }),
    }));
    render(<StrategyTool initial={initial} />);
    await screen.findByText("1:20:21.500");   // the first run has no driver, so the model's plain answer
    await userEvent.selectOptions(screen.getByLabelText("Compare with a driver's real race"), "HAM");
    await userEvent.click(screen.getByRole("button", { name: "Update simulation" }));
    await waitFor(() => expect(screen.getByText(/Your plan is 3\.2 s faster than HAM's real strategy/)).toBeInTheDocument());
    const calls = post.mock.calls.slice(1).map((c) => c[1] as any);
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.driver_code)).toMatchObject({ driver_code: "HAM" });
    expect(calls.find((c) => !c.driver_code)!.stints).toEqual([{ compound: "MEDIUM", laps: 11 }, { compound: "HARD", laps: 33 }]);
  });

  it("shows the server's message when a simulation fails", async () => {
    post.mockRejectedValue({ response: { status: 400, data: { detail: "Your plan covers 40 laps but this race is 44 laps long: 4 laps short." } } });
    render(<StrategyTool initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your plan covers 40 laps but this race is 44 laps long");
  });

  it("explains a race that couldn't be loaded", () => {
    sessionInfo.mockReturnValue({ status: "error", message: "There's no data for round 14 2024 yet.", notFound: true, retry: vi.fn() });
    render(<StrategyTool initial={initial} />);
    expect(screen.getByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(post).not.toHaveBeenCalled();
  });

  it("waits for the race distance before offering to plan", () => {
    sessionInfo.mockReturnValue({ status: "loading", retry: vi.fn() });
    render(<StrategyTool initial={initial} />);
    expect(screen.getByText("Choose a race to see its distance.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add stint" })).toBeDisabled();
  });
});
