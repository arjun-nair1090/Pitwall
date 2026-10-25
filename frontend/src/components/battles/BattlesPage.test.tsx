import { render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BattlesPage from "./BattlesPage";
import { BATTLES } from "./fixtures";
import type { Race } from "@/lib/season";

vi.mock("axios");
const post = vi.mocked(axios.post);

const races: Race[] = [
  { round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["FP1", "Q", "S", "R"] },
];
vi.mock("@/hooks/useRaceData", () => ({ useSeasonRaces: () => ({ status: "ready", data: races, retry: vi.fn() }) }));

const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: BATTLES });
});

describe("BattlesPage", () => {
  it("analyses the chosen session straight away", async () => {
    render(<BattlesPage initial={initial} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/race-battles", { year: 2024, round: 14, session: "R" });
    expect(await screen.findByText("Williams")).toBeInTheDocument();
  });

  it("offers only the sprint and the race", async () => {
    render(<BattlesPage initial={initial} />);
    const options = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["S", "R"]);
    await screen.findByRole("heading", { name: "Drivers", level: 2 });
  });

  it("has the lap chart, drivers, passes and battles panels", async () => {
    render(<BattlesPage initial={initial} />);
    expect(await screen.findByRole("heading", { name: "Drivers", level: 2 })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Lap chart")).toBeGreaterThan(-1);
    expect(headings.indexOf("Lap chart")).toBeLessThan(headings.indexOf("Drivers"));
    expect(await screen.findByLabelText("Highlight")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Passes", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Battles", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("2024, round 14, Race")).toBeInTheDocument();
  });

  it("explains what the numbers can't see", async () => {
    render(<BattlesPage initial={initial} />);
    expect(
      await screen.findByText(
        "Positions are read at the end of each lap, so a pass and re-pass within one lap won't show, and passes during pit stops or behind a safety car don't count. After a red flag, places changed at the standing restart count as passes.",
      ),
    ).toBeInTheDocument();
  });

  it("analyses the race when the link names a session it can't analyse", async () => {
    render(<BattlesPage initial={{ ...initial, session: "Q" }} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/race-battles", { year: 2024, round: 14, session: "R" });
    await screen.findByRole("heading", { name: "Drivers", level: 2 });
  });

  it("shows the server's message for a session with no data, without a retry", async () => {
    post.mockRejectedValue({ response: { status: 404, data: { detail: "There's no data for round 14 2024 yet." } } });
    render(<BattlesPage initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("says the first load can be slow", async () => {
    post.mockReturnValue(new Promise(() => {}));
    render(<BattlesPage initial={initial} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/can take up to a minute/i);
  });
});
