import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PedalAnalysis from "./PedalAnalysis";
import type { Race } from "@/lib/season";

vi.mock("axios");
const post = vi.mocked(axios.post);

const races: Race[] = [
  { round: 13, country: "Hungary", location: "Budapest", event_name: "Hungarian Grand Prix", race_start_utc: "2024-07-21T13:00:00Z", sessions: ["FP1", "Q", "R"] },
  { round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["FP1", "Q", "R"] },
];
vi.mock("@/hooks/useRaceData", () => ({ useSeasonRaces: () => ({ status: "ready", data: races, retry: vi.fn() }) }));
vi.mock("./PedalChart", () => ({ default: ({ rows }: { rows: unknown[] }) => <div data-testid="chart">{rows.length} drivers</div> }));

const ROWS = [
  { driver_code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6", lap_time: 106.1, throttle_pct: 80, brake_pct: 12, both_pct: 1, coast_pct: 7 },
  { driver_code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000", lap_time: 105.8, throttle_pct: 81, brake_pct: 11, both_pct: 1, coast_pct: 7 },
];
const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: { data: ROWS } });
});

describe("PedalAnalysis", () => {
  it("analyses the chosen session straight away, with no separate button to press", async () => {
    render(<PedalAnalysis initial={initial} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/pedal-behavior", { year: 2024, round: 14, session: "R" });
    expect(await screen.findByTestId("chart")).toHaveTextContent("2 drivers");
  });

  it("keeps the session picker in line with what was analysed", async () => {
    render(<PedalAnalysis initial={initial} />);
    expect((screen.getByLabelText("Session") as HTMLSelectElement).value).toBe("R");
    expect(await screen.findByRole("heading", { name: "Pedal behaviour" })).toBeInTheDocument();
    expect(screen.getByText("2024, round 14, Race")).toBeInTheDocument();
  });

  it("runs again when the session changes", async () => {
    render(<PedalAnalysis initial={initial} />);
    await screen.findByTestId("chart");
    await userEvent.selectOptions(screen.getByLabelText("Session"), "Q");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ year: 2024, round: 14, session: "Q" });
  });

  it("says the first load can be slow", async () => {
    post.mockReturnValue(new Promise(() => {}));
    render(<PedalAnalysis initial={initial} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/can take up to a minute/i);
  });

  it("shows the server's message for a session with no data, without a retry", async () => {
    post.mockRejectedValue({ response: { status: 404, data: { detail: "There's no data for round 14 2024 yet." } } });
    render(<PedalAnalysis initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("offers a retry when the server failed", async () => {
    post.mockRejectedValueOnce({ response: { status: 502, data: { detail: "Couldn't load the pedal analysis right now. Try again shortly." } } });
    render(<PedalAnalysis initial={initial} />);
    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("chart")).toBeInTheDocument();
  });

  it("doesn't ask for anything until a race is chosen", () => {
    render(<PedalAnalysis initial={{ ...initial, round: null }} />);
    // the picker fills in the newest race; until then there is nothing to analyse
    expect(post).not.toHaveBeenCalledWith("/api/v1/telemetry/pedal-behavior", expect.objectContaining({ round: null }));
  });
});
