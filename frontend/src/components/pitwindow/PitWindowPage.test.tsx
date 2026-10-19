import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PitWindowPage from "./PitWindowPage";
import { PIT_WINDOW } from "./fixtures";
import type { Race } from "@/lib/season";

vi.mock("axios");
const post = vi.mocked(axios.post);

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const races: Race[] = [
  { round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["FP1", "Q", "S", "R"] },
];
vi.mock("@/hooks/useRaceData", () => ({ useSeasonRaces: () => ({ status: "ready", data: races, retry: vi.fn() }) }));

const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };
const URL = "/api/v1/telemetry/pit-window";
const lapsAsked = () => post.mock.calls.map((c) => (c[1] as { lap: number }).lap);

// The server answers for whichever lap it was asked about.
const answer = (_url: string, body?: unknown) => Promise.resolve({ data: { ...PIT_WINDOW, lap: (body as { lap: number }).lap } });

beforeEach(() => {
  replace.mockReset();
  post.mockReset().mockImplementation(answer as never);
});

describe("PitWindowPage", () => {
  it("asks for lap 10 first, then moves to a third of the way in once the race length is known", async () => {
    render(<PitWindowPage initial={initial} />);
    await waitFor(() => expect(lapsAsked()).toEqual([10, 14]));
    expect(post).toHaveBeenNthCalledWith(1, URL, { year: 2024, round: 14, session: "R", lap: 10 });
    expect(await screen.findByText("Lap 14 of 44")).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/pitwindow?year=2024&round=14&session=R&lap=14", { scroll: false }));
  });

  it("opens on the lap in the link and asks only once", async () => {
    render(<PitWindowPage initial={{ ...initial, lap: 20 }} />);
    expect(await screen.findByText("Lap 20 of 44")).toBeInTheDocument();
    expect(lapsAsked()).toEqual([20]);
  });

  it("refetches and updates the link when the lap changes", async () => {
    render(<PitWindowPage initial={{ ...initial, lap: 20 }} />);
    await screen.findByText("Lap 20 of 44");
    fireEvent.click(screen.getByRole("button", { name: "Next lap" }));
    await waitFor(() => expect(lapsAsked()).toEqual([20, 21]));
    expect(replace).toHaveBeenLastCalledWith("/pitwindow?year=2024&round=14&session=R&lap=21", { scroll: false });
    expect(await screen.findByText("Lap 21 of 44")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Lap" }), { target: { value: "30" } });
    await waitFor(() => expect(lapsAsked()).toEqual([20, 21, 30]));
  });

  it("stops at lap 1 and at the lap before the last", async () => {
    const { unmount } = render(<PitWindowPage initial={{ ...initial, lap: 1 }} />);
    await screen.findByText("Lap 1 of 44");
    expect(screen.getByRole("button", { name: "Previous lap" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next lap" })).toBeEnabled();
    unmount();
    render(<PitWindowPage initial={{ ...initial, lap: 43 }} />);
    await screen.findByText("Lap 43 of 44");
    expect(screen.getByRole("button", { name: "Next lap" })).toBeDisabled();
  });

  it("clamps the first lap to the lap before the last in a very short race", async () => {
    post.mockReset().mockImplementation(((_u: string, body: { lap: number }) =>
      body.lap > 7
        ? Promise.reject({ response: { status: 422, data: { detail: "Pick a lap from 1 to 7." } } })
        : Promise.resolve({ data: { ...PIT_WINDOW, total_laps: 8, lap: body.lap } })) as never);
    render(<PitWindowPage initial={initial} />);
    expect(await screen.findByText("Lap 7 of 8")).toBeInTheDocument();
    expect(lapsAsked()).toEqual([10, 7]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the plans, the undercuts and the tyre model for the lap", async () => {
    render(<PitWindowPage initial={{ ...initial, lap: 18 }} />);
    expect(await screen.findByText("Box lap 23 → Hard")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Choose a session", "Lap", "Pit plans", "Undercut threats", "Tyre model"]);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("NOR on VER · 1.2 s behind · undercut gains 1.9 s → Likely");
    expect(screen.getByText("Pit stop costs 21.4 s")).toBeInTheDocument();
  });

  it("explains what the model can't see and what an in-lap shows", async () => {
    render(<PitWindowPage initial={{ ...initial, lap: 18 }} />);
    expect(
      await screen.findByText(
        "Worked out from only the laps run so far, as the pit wall would have seen it. Traffic, tyre warm-up and weather changes aren't modelled.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("A car that pits at the end of this lap still shows the tyres it came in on.")).toBeInTheDocument();
  });

  it("offers only the sprint and the race", async () => {
    render(<PitWindowPage initial={{ ...initial, lap: 18 }} />);
    const options = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["S", "R"]);
    await screen.findByText("Box lap 23 → Hard");
  });

  it("analyses the race when the link names a session it can't analyse", async () => {
    render(<PitWindowPage initial={{ ...initial, session: "Q", lap: 18 }} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(URL, { year: 2024, round: 14, session: "R", lap: 18 });
    await screen.findByText("Box lap 23 → Hard");
  });

  it("shows the server's message for a bad lap, without a retry, and keeps the stepper usable", async () => {
    post.mockReset().mockImplementation(((_u: string, body: { lap: number }) =>
      body.lap > 43
        ? Promise.reject({ response: { status: 422, data: { detail: "Pick a lap from 1 to 43." } } })
        : Promise.resolve({ data: { ...PIT_WINDOW, lap: body.lap } })) as never);
    render(<PitWindowPage initial={{ ...initial, lap: 99 }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a lap from 1 to 43.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(lapsAsked()).toEqual([99]);
    fireEvent.change(screen.getByRole("slider", { name: "Lap" }), { target: { value: "30" } });
    expect(await screen.findByText("Box lap 23 → Hard")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's message for an unknown race, without a retry", async () => {
    post.mockReset().mockRejectedValue({ response: { status: 404, data: { detail: "There's no data for round 14 2024 yet." } } });
    render(<PitWindowPage initial={{ ...initial, lap: 18 }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("shows only the lap, with the controls off, while the first answer is on its way", async () => {
    post.mockReset().mockReturnValue(new Promise(() => {}));
    render(<PitWindowPage initial={initial} />);
    expect(await screen.findByText("Lap 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next lap" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/can take up to a minute/i);
  });
});
