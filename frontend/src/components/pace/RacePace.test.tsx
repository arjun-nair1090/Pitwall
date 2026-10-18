import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RacePace from "./RacePace";
import { PACE } from "./fixtures";
import type { Race } from "@/lib/season";

vi.mock("axios");
const post = vi.mocked(axios.post);

const races: Race[] = [
  { round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["FP1", "Q", "S", "R"] },
];
vi.mock("@/hooks/useRaceData", () => ({ useSeasonRaces: () => ({ status: "ready", data: races, retry: vi.fn() }) }));

const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: PACE });
});

describe("RacePace", () => {
  it("analyses the chosen session straight away", async () => {
    render(<RacePace initial={initial} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/race-pace", { year: 2024, round: 14, session: "R" });
    expect(await screen.findByText("NOR")).toBeInTheDocument();
  });

  it("analyses the race when the link names a session it can't analyse", async () => {
    render(<RacePace initial={{ ...initial, session: "Q" }} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/race-pace", { year: 2024, round: 14, session: "R" });
    expect(await screen.findByText("NOR")).toBeInTheDocument();
  });

  it("keeps a sprint from the link", async () => {
    render(<RacePace initial={{ ...initial, session: "S" }} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/race-pace", { year: 2024, round: 14, session: "S" });
    await screen.findByText("NOR");
  });

  it("offers only the sprint and the race, in calendar order", async () => {
    render(<RacePace initial={initial} />);
    const options = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["S", "R"]);
    await screen.findByText("NOR");
  });

  it("names the analysed session in the ranking panel", async () => {
    render(<RacePace initial={initial} />);
    expect(await screen.findByRole("heading", { name: "Race pace", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("2024, round 14, Race")).toBeInTheDocument();
  });

  it("never shows the previous session's numbers while the next one loads", async () => {
    render(<RacePace initial={initial} />);
    await screen.findByText("NOR");
    post.mockReturnValue(new Promise(() => {}));
    await userEvent.selectOptions(screen.getByLabelText("Session"), "S");
    expect(screen.queryByText("NOR")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("states the fuel correction's assumptions from the payload", async () => {
    render(<RacePace initial={initial} />);
    expect(
      await screen.findByText(
        "Fuel-corrected assuming 110 kg at the start burned evenly over 44 laps at 0.03 s per kg: 0.075 s a lap. Every lap is shown as if run on the final lap's fuel.",
      ),
    ).toBeInTheDocument();
  });

  it("rounds the fuel figures for reading", async () => {
    post.mockResolvedValue({ data: { ...PACE, fuel: { ...PACE.fuel, start_kg: 105, total_laps: 52, seconds_per_lap: 0.0605769 } } });
    render(<RacePace initial={initial} />);
    expect(
      await screen.findByText(
        "Fuel-corrected assuming 105 kg at the start burned evenly over 52 laps at 0.03 s per kg: 0.061 s a lap. Every lap is shown as if run on the final lap's fuel.",
      ),
    ).toBeInTheDocument();
  });

  it("states a sprint's fuel as the race rate, so the figures add up", async () => {
    // 19 laps of a sprint burn like 58 laps of a race: 110 / (19 × 3.05) kg a lap
    const kg = 110 / (19 * 3.05);
    post.mockResolvedValue({ data: { ...PACE, fuel: { ...PACE.fuel, kg_per_lap: kg, seconds_per_lap: 0.03 * kg, total_laps: 19 } } });
    render(<RacePace initial={{ ...initial, session: "S" }} />);
    expect(
      await screen.findByText(
        "Fuel-corrected assuming a sprint burns at a race's rate, 110 kg over 58 laps at 0.03 s per kg: 0.057 s a lap. Every lap is shown as if run on the final lap's fuel.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the server's message for a session with no data, without a retry", async () => {
    post.mockRejectedValue({ response: { status: 404, data: { detail: "There's no data for round 14 2024 yet." } } });
    render(<RacePace initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("adds the stint and tyre degradation panels under the ranking", async () => {
    render(<RacePace initial={initial} />);
    expect(await screen.findByRole("heading", { name: "Stints", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tyre degradation", level: 2 })).toBeInTheDocument();
  });

  it("says the first load can be slow", async () => {
    post.mockReturnValue(new Promise(() => {}));
    render(<RacePace initial={initial} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/can take up to a minute/i);
  });
});
