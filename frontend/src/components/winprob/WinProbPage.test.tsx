import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import { cloneElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WinProbPage from "./WinProbPage";
import { WIN_PROB } from "./fixtures";
import type { Race } from "@/lib/season";

vi.mock("axios");
const post = vi.mocked(axios.post);

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 360 }) };
});

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const races: Race[] = [
  { round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["FP1", "Q", "S", "R"] },
  { round: 15, country: "Netherlands", location: "Zandvoort", event_name: "Dutch Grand Prix", race_start_utc: "2024-08-25T13:00:00Z", sessions: ["FP1", "Q", "R"] },
];
vi.mock("@/hooks/useRaceData", () => ({ useSeasonRaces: () => ({ status: "ready", data: races, retry: vi.fn() }) }));

const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };
const URL = "/api/v1/telemetry/win-probability";
const bodies = () => post.mock.calls.map((c) => c[1] as Record<string, unknown>);
const lapsAsked = () => bodies().map((b) => b.lap);

// The server answers for the lap it is asked about, or lap 4 when it isn't.
const answer = (_url: string, body?: unknown) => {
  const { lap = 4, round, session } = body as { lap?: number; round: number; session: string };
  return Promise.resolve({ data: { ...WIN_PROB, round, session, at: { ...WIN_PROB.at, lap } } });
};

beforeEach(() => {
  replace.mockReset();
  post.mockReset().mockImplementation(answer as never);
});

describe("WinProbPage", () => {
  it("leaves the lap out of the first request and takes the lap and the length from the answer", async () => {
    render(<WinProbPage initial={initial} />);
    expect(await screen.findByText("Lap 4 of 6")).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(URL, { year: 2024, round: 14, session: "R" });
    expect(bodies()[0]).not.toHaveProperty("lap");
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/winprob?year=2024&round=14&session=R&lap=4", { scroll: false }));
  });

  it("sends the lap in the link on the first request, and asks once", async () => {
    render(<WinProbPage initial={{ ...initial, lap: 2 }} />);
    expect(await screen.findByText("Lap 2 of 6")).toBeInTheDocument();
    expect(lapsAsked()).toEqual([2]);
    expect(post).toHaveBeenCalledWith(URL, { year: 2024, round: 14, session: "R", lap: 2 });
  });

  it("clamps a linked lap past the end to the last lap, with one refusal and no error", async () => {
    post.mockReset().mockImplementation(((_u: string, body: { lap?: number }) =>
      (body.lap ?? 0) > 6
        ? Promise.reject({ response: { status: 422, data: { detail: "Pick a lap from 1 to 6." } } })
        : answer(_u, body)) as never);
    render(<WinProbPage initial={{ ...initial, lap: 60 }} />);
    expect(await screen.findByText("Lap 6 of 6")).toBeInTheDocument();
    expect(lapsAsked()).toEqual([60, 6]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refetches with the new lap and updates the link when the lap changes", async () => {
    render(<WinProbPage initial={initial} />);
    await screen.findByText("Lap 4 of 6");
    fireEvent.click(screen.getByRole("button", { name: "Next lap" }));
    await waitFor(() => expect(lapsAsked()).toEqual([undefined, 5]));
    expect(await screen.findByText("Lap 5 of 6")).toBeInTheDocument();
    expect(replace).toHaveBeenLastCalledWith("/winprob?year=2024&round=14&session=R&lap=5", { scroll: false });
    fireEvent.change(screen.getByRole("slider", { name: "Lap" }), { target: { value: "2" } });
    await waitFor(() => expect(lapsAsked()).toEqual([undefined, 5, 2]));
  });

  it("can step to the final lap, where the stepper stops", async () => {
    render(<WinProbPage initial={{ ...initial, lap: 5 }} />);
    await screen.findByText("Lap 5 of 6");
    fireEvent.click(screen.getByRole("button", { name: "Next lap" }));
    expect(await screen.findByText("Lap 6 of 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next lap" })).toBeDisabled();
  });

  it("shows the chart and the table for the lap, with the caveat", async () => {
    render(<WinProbPage initial={initial} />);
    expect(await screen.findByRole("img", { name: /chance of winning/i })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Choose a session", "Lap", "Chance of winning", "The field at this lap"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["2", "VER", "+3.4 s", "—", "55.0%", "Window opens lap 21"]);
    expect(
      screen.getByText(
        "Each lap is worked out only from the laps run so far: every driver's best remaining strategy, plus thousands of simulated finishes with random pace, retirements and a possible safety car. It predicts who crosses the line first, so a later penalty or disqualification isn't known to it.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the chart on screen while the next lap loads, then updates the table", async () => {
    let release: () => void = () => {};
    post.mockReset().mockImplementation(((_u: string, body: { lap?: number }) =>
      body.lap === 5
        ? new Promise((resolve) => {
            release = () =>
              resolve({
                data: { ...WIN_PROB, at: { lap: 5, rows: WIN_PROB.at.rows.map((r) => ({ ...r, probability: r.code === "VER" ? 0.7 : r.probability })) } },
              });
          })
        : answer(_u, body)) as never);
    render(<WinProbPage initial={initial} />);
    const chart = await screen.findByRole("img", { name: /chance of winning/i });
    const xOf = () => Number(document.querySelector(".recharts-reference-line line")?.getAttribute("x1"));
    const before = xOf();
    fireEvent.click(screen.getByRole("button", { name: "Next lap" }));
    await waitFor(() => expect(lapsAsked()).toEqual([undefined, 5]));
    expect(screen.getByRole("img", { name: /chance of winning/i })).toBe(chart);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(xOf()).toBeGreaterThan(before);
    expect(screen.getByRole("table").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("row")[2]).toHaveTextContent("55.0%");
    release();
    await waitFor(() => expect(screen.getAllByRole("row")[2]).toHaveTextContent("70.0%"));
    expect(screen.getByRole("table").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  });

  it("drops the old race's chart when another race is picked", async () => {
    render(<WinProbPage initial={initial} />);
    await screen.findByRole("img", { name: /chance of winning/i });
    post.mockReset().mockReturnValue(new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Race"), { target: { value: "15" } });
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /chance of winning/i })).not.toBeInTheDocument();
  });

  it("offers only the sprint and the race", async () => {
    render(<WinProbPage initial={initial} />);
    const options = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["S", "R"]);
    await screen.findByRole("img", { name: /chance of winning/i });
  });

  it("asks for the race when the link names a session it can't analyse", async () => {
    render(<WinProbPage initial={{ ...initial, session: "Q", lap: 3 }} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(URL, { year: 2024, round: 14, session: "R", lap: 3 });
    await screen.findByText("Lap 3 of 6");
  });

  it("starts the new race afresh, without a lap, when another race is picked", async () => {
    render(<WinProbPage initial={{ ...initial, lap: 2 }} />);
    await screen.findByText("Lap 2 of 6");
    fireEvent.change(screen.getByLabelText("Race"), { target: { value: "15" } });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith(URL, { year: 2024, round: 15, session: "R" });
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/winprob?year=2024&round=15&session=R&lap=4", { scroll: false }));
  });

  it("says what is happening while the first answer is on its way, with the stepper off", async () => {
    post.mockReset().mockReturnValue(new Promise(() => {}));
    render(<WinProbPage initial={initial} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Working out every lap of the race… The first time a race is opened this can take up to a minute.",
    );
    expect(screen.getByRole("button", { name: "Next lap" })).toBeDisabled();
  });

  it("shows the server's message for an unknown race, without a retry", async () => {
    post.mockReset().mockRejectedValue({ response: { status: 404, data: { detail: "There's no data for round 14 2024 yet." } } });
    render(<WinProbPage initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("shows a refusal's message without a retry", async () => {
    post.mockReset().mockRejectedValue({ response: { status: 422, data: { detail: "Win probability needs a race or a sprint." } } });
    render(<WinProbPage initial={initial} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Win probability needs a race or a sprint.");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("offers a retry for a failure that might pass", async () => {
    post.mockReset().mockRejectedValue({ response: { status: 500, data: {} } });
    render(<WinProbPage initial={initial} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
