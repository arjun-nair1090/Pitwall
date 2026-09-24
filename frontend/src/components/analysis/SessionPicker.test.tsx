import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SessionPicker, { type RaceSelection } from "./SessionPicker";
import type { Race } from "@/lib/season";

const seasonState = vi.fn();
vi.mock("@/hooks/useRaceData", () => ({ useSeasonRaces: (...args: unknown[]) => seasonState(...args) }));

const race = (round: number, name: string, sessions?: Race["sessions"]): Race => ({
  round, country: "X", location: "Y", event_name: name, race_start_utc: "2020-01-01T00:00:00Z", sessions,
});
const ready = (data: Race[]) => ({ status: "ready", data, retry: vi.fn() });

const THIS_YEAR = new Date().getFullYear();
const base: RaceSelection = { year: 2020, round: 2, session: "R" };

beforeEach(() => seasonState.mockReset());

describe("SessionPicker", () => {
  it("offers every season back to 2018 and only completed races", () => {
    seasonState.mockReturnValue(ready([race(1, "Australian Grand Prix"), race(2, "Chinese Grand Prix")]));
    render(<SessionPicker value={base} onChange={vi.fn()} />);
    const season = screen.getByLabelText("Season") as HTMLSelectElement;
    expect(season.value).toBe("2020");
    expect(within(season).getAllByRole("option").at(-1)).toHaveTextContent("2018");
    const raceSelect = screen.getByLabelText("Race") as HTMLSelectElement;
    expect(within(raceSelect).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Round 1: Australian Grand Prix", "Round 2: Chinese Grand Prix",
    ]);
    expect(raceSelect.value).toBe("2");
  });

  it("picks the latest race once a season has loaded and none is chosen", () => {
    seasonState.mockReturnValue(ready([race(1, "A"), race(2, "B"), race(3, "C")]));
    const onChange = vi.fn();
    render(<SessionPicker value={{ ...base, round: null }} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({ year: 2020, round: 3, session: "R" });
  });

  it("moves to the newest race when the chosen round isn't in the new season", () => {
    seasonState.mockReturnValue(ready([race(1, "A"), race(2, "B")]));
    const onChange = vi.fn();
    render(<SessionPicker value={{ ...base, round: 9 }} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({ year: 2020, round: 2, session: "R" });
  });

  it("clears the round when the season changes", async () => {
    seasonState.mockReturnValue(ready([race(1, "A"), race(2, "B")]));
    const onChange = vi.fn();
    render(<SessionPicker value={base} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Season"), "2019");
    expect(onChange).toHaveBeenCalledWith({ year: 2019, round: null, session: "R" });
  });

  it("only offers the sessions that weekend ran", () => {
    seasonState.mockReturnValue(ready([race(2, "Sprint weekend", ["FP1", "SQ", "S", "Q", "R"])]));
    render(<SessionPicker value={base} onChange={vi.fn()} />);
    const sessions = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => o.textContent);
    expect(sessions).toEqual(["Practice 1", "Sprint qualifying", "Sprint", "Qualifying", "Race"]);
  });

  it("can be limited to some sessions", () => {
    seasonState.mockReturnValue(ready([race(2, "B", ["FP1", "Q", "R"])]));
    render(<SessionPicker value={base} onChange={vi.fn()} allowedSessions={["Q", "R"]} />);
    const sessions = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => o.textContent);
    expect(sessions).toEqual(["Qualifying", "Race"]);
  });

  it("can hide the session choice for race-only tools", () => {
    seasonState.mockReturnValue(ready([race(2, "B")]));
    render(<SessionPicker value={base} onChange={vi.fn()} showSession={false} />);
    expect(screen.queryByLabelText("Session")).not.toBeInTheDocument();
  });

  it("switches to a session the weekend has when the current one doesn't exist", () => {
    seasonState.mockReturnValue(ready([race(2, "B", ["FP1", "Q"])]));
    const onChange = vi.fn();
    render(<SessionPicker value={{ ...base, session: "R" }} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({ year: 2020, round: 2, session: "FP1" });
  });

  it("falls back to last season when the current one has no completed race yet", () => {
    seasonState.mockReturnValue(ready([]));
    const onChange = vi.fn();
    render(<SessionPicker value={{ year: THIS_YEAR, round: null, session: "R" }} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({ year: THIS_YEAR - 1, round: null, session: "R" });
  });

  it("says so when an older season has nothing to show", () => {
    seasonState.mockReturnValue(ready([]));
    render(<SessionPicker value={base} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Race")).toBeDisabled();
    expect(screen.getByText(/no completed races/i)).toBeInTheDocument();
  });

  it("disables the race list while loading", () => {
    seasonState.mockReturnValue({ status: "loading", retry: vi.fn() });
    render(<SessionPicker value={{ ...base, round: null }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Race")).toBeDisabled();
    expect(within(screen.getByLabelText("Race")).getByRole("option")).toHaveTextContent("Loading races");
  });

  it("explains a failed load and lets the user retry", async () => {
    const retry = vi.fn();
    seasonState.mockReturnValue({ status: "error", message: "Calendar unavailable.", notFound: false, retry });
    render(<SessionPicker value={{ ...base, round: null }} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Calendar unavailable.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});
