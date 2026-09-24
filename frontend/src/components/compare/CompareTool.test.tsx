import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompareTool from "./CompareTool";
import type { SessionDriver } from "@/hooks/useRaceData";
import type { Race } from "@/lib/season";

vi.mock("axios");
const post = vi.mocked(axios.post);

const sessionInfo = vi.fn();
vi.mock("@/hooks/useRaceData", () => ({
  useSeasonRaces: () => ({ status: "ready", data: [{ round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["FP1", "Q", "R"] } satisfies Race], retry: vi.fn() }),
  useSessionInfo: (...args: unknown[]) => sessionInfo(...args),
}));
vi.mock("./DominanceMap", () => ({ default: ({ code1, code2 }: { code1: string; code2: string }) => <div data-testid="map">{code1} vs {code2}</div> }));
vi.mock("./DuelCharts", () => ({ default: ({ code1, code2 }: { code1: string; code2: string }) => <div data-testid="charts">{code1} vs {code2}</div> }));

const drv = (code: string, name: string, position: number, over: Partial<SessionDriver> = {}): SessionDriver => ({
  code, name, team: "Team", color: "#3671C6", position, status: "Finished", laps: 44, fastest_lap: 30 + position, fastest_time: 106, stints: [], ...over,
});
const info = {
  year: 2024, round: 14, event_name: "Belgian Grand Prix", session: "R", total_laps: 44,
  drivers: [drv("HAM", "Lewis Hamilton", 1), drv("PIA", "Oscar Piastri", 2), drv("VER", "Max Verstappen", 3)],
};
const ready = (data: unknown) => ({ status: "ready", data, retry: vi.fn() });

const telemetry = Array.from({ length: 5 }, (_, i) => ({ distance: i * 100, speed: 200, throttle: 100, brake: 0, gear: 5, rpm: 10000, drs: 0, time: i, x: i, y: 0, acceleration: 0 }));
const side = (code: string, name: string, lap: number, time: number) => ({ code, name, team: "Team", color: "#3671C6", lap_number: lap, lap_time: time, compound: "MEDIUM", telemetry });
const RESULT = { driver1: side("HAM", "Lewis Hamilton", 31, 105.9), driver2: side("PIA", "Oscar Piastri", 32, 106.2) };

const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: RESULT });
  sessionInfo.mockReset().mockReturnValue(ready(info));
});

describe("CompareTool", () => {
  it("compares the top two finishers as soon as the session loads", async () => {
    render(<CompareTool initial={initial} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/compare", { year: 2024, round: 14, session: "R", driver1: "HAM", driver2: "PIA" });
    expect(await screen.findByTestId("map")).toHaveTextContent("HAM vs PIA");
    expect(screen.getByTestId("charts")).toBeInTheDocument();
    expect(screen.getByText("Lewis Hamilton")).toBeInTheDocument();
  });

  it("uses the drivers from the link when they took part", async () => {
    render(<CompareTool initial={{ ...initial, d1: "VER", d2: "HAM" }} />);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ driver1: "VER", driver2: "HAM" });
  });

  it("falls back to the top two when a linked driver didn't take part", async () => {
    render(<CompareTool initial={{ ...initial, d1: "XXX", d2: "HAM" }} />);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ driver1: "HAM", driver2: "PIA" });
  });

  it("says the first load can be slow while it waits", async () => {
    post.mockReturnValue(new Promise(() => {}));
    render(<CompareTool initial={initial} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/can take up to a minute/i);
  });

  it("doesn't reload until the user asks, then sends the new choice with its laps", async () => {
    render(<CompareTool initial={initial} />);
    await screen.findByTestId("map");
    await userEvent.selectOptions(screen.getByLabelText("Driver 2"), "VER");
    await userEvent.selectOptions(screen.getByLabelText("Driver 2 lap"), "12");
    expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Update comparison" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ year: 2024, round: 14, session: "R", driver1: "HAM", driver2: "VER", driver2_lap: 12 });
  });

  it("shows the server's message when the laps can't be compared, without a retry for missing data", async () => {
    post.mockRejectedValue({ response: { status: 404, data: { detail: "PIA has no lap 99 (they completed 44 laps)." } } });
    render(<CompareTool initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("PIA has no lap 99 (they completed 44 laps).");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("offers a retry when the server failed", async () => {
    post.mockRejectedValueOnce({ response: { status: 502, data: { detail: "Couldn't load the telemetry comparison right now. Try again shortly." } } });
    render(<CompareTool initial={initial} />);
    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("map")).toBeInTheDocument();
  });

  it("explains a session that couldn't be loaded", () => {
    sessionInfo.mockReturnValue({ status: "error", message: "There's no data for round 14 2024 yet.", notFound: true, retry: vi.fn() });
    render(<CompareTool initial={initial} />);
    expect(screen.getByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(post).not.toHaveBeenCalled();
  });

  it("waits for the session's drivers before comparing", () => {
    sessionInfo.mockReturnValue({ status: "loading", retry: vi.fn() });
    render(<CompareTool initial={initial} />);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Driver 1")).toBeDisabled();
  });
});
