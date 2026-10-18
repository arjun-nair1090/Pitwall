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
  post.mockReset().mockResolvedValue({ data: { data: PACE } });
});

describe("RacePace", () => {
  it("analyses the chosen session straight away", async () => {
    render(<RacePace initial={initial} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/race-pace", { year: 2024, round: 14, session: "R" });
    expect(await screen.findByText("NOR")).toBeInTheDocument();
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

  it("explains the fuel correction from the payload", async () => {
    render(<RacePace initial={initial} />);
    expect(
      await screen.findByText(
        "Fuel-corrected at 0.075 s a lap (2.50 kg a lap at 0.03 s per kg): every lap is shown as if run on the final lap's fuel.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the server's message for a session with no data, without a retry", async () => {
    post.mockRejectedValue({ response: { status: 404, data: { detail: "There's no data for round 14 2024 yet." } } });
    render(<RacePace initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("says the first load can be slow", async () => {
    post.mockReturnValue(new Promise(() => {}));
    render(<RacePace initial={initial} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/can take up to a minute/i);
  });
});
