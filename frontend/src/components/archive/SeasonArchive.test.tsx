import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SeasonArchive from "./SeasonArchive";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

const calendar = vi.fn();
const standings = vi.fn();
const results = vi.fn();
vi.mock("@/hooks/useRaceData", () => ({
  useSeasonCalendar: (...a: unknown[]) => calendar(...a),
  useStandings: (...a: unknown[]) => standings(...a),
  useRaceResults: (...a: unknown[]) => results(...a),
}));

const ready = (data: unknown) => ({ status: "ready", data, retry: vi.fn() });
const idle = { status: "idle", retry: vi.fn() };
const loading = { status: "loading", retry: vi.fn() };
const failed = (message: string, notFound = false) => ({ status: "error", message, notFound, retry: vi.fn() });

const STANDINGS = {
  year: 2024,
  driver_standings: [
    { position: 1, points: 437, wins: 9, driver_name: "Max Verstappen", driver_code: "VER", driver_number: 1, team_name: "Red Bull Racing" },
    { position: 2, points: 374, wins: 4, driver_name: "Lando Norris", driver_code: "NOR", driver_number: 4, team_name: "McLaren" },
  ],
  constructor_standings: [
    { position: 1, points: 666, wins: 6, team_name: "McLaren" },
    { position: 2, points: 652, wins: 5, team_name: "Ferrari" },
  ],
};

const CALENDAR = [
  { round: 1, country: "Bahrain", location: "Sakhir", event_name: "Bahrain Grand Prix", race_start_utc: "2024-03-02T15:00:00Z" },
  { round: 2, country: "Saudi Arabia", location: "Jeddah", event_name: "Saudi Arabian Grand Prix", race_start_utc: "2024-03-09T17:00:00Z" },
  { round: 3, country: "Australia", location: "Melbourne", event_name: "Australian Grand Prix", race_start_utc: "2999-03-24T04:00:00Z" },
];

const RESULTS = {
  year: 2024, round: 1,
  classification: [
    { position: 1, code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6", grid: 1, status: "Finished", finished: true, points: 26, race_time_seconds: 5504.742, gap_seconds: null },
    { position: 2, code: "PER", name: "Sergio Perez", team: "Red Bull Racing", color: "#3671C6", grid: 5, status: "Finished", finished: true, points: 18, race_time_seconds: null, gap_seconds: 22.457 },
    { position: 3, code: "HAM", name: "Lewis Hamilton", team: "Mercedes", color: "#27F4D2", grid: 7, status: "Lapped", finished: true, points: 0, race_time_seconds: null, gap_seconds: null },
    { position: 4, code: "ALO", name: "Fernando Alonso", team: "Aston Martin", color: "#229971", grid: 4, status: "Engine", finished: false, points: null, race_time_seconds: null, gap_seconds: null },
  ],
};

beforeEach(() => {
  calendar.mockReset().mockReturnValue(ready(CALENDAR));
  standings.mockReset().mockReturnValue(ready(STANDINGS));
  results.mockReset().mockReturnValue(idle);
});

describe("SeasonArchive standings", () => {
  it("opens on the standings with drivers and constructors", () => {
    render(<SeasonArchive initialYear={2024} />);
    const drivers = screen.getByRole("table", { name: /drivers' championship/i });
    expect(within(drivers).getByText("Max Verstappen")).toBeInTheDocument();
    expect(within(drivers).getByText("437")).toBeInTheDocument();
    const constructors = screen.getByRole("table", { name: /constructors' championship/i });
    expect(within(constructors).getByText("McLaren")).toBeInTheDocument();
  });

  it("shows a loading state while standings load", () => {
    standings.mockReturnValue(loading);
    render(<SeasonArchive initialYear={2024} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("explains a season with no standings instead of showing an empty table", () => {
    standings.mockReturnValue(failed("No standings data available for this year.", false));
    render(<SeasonArchive initialYear={2024} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No standings data available for this year.");
  });

  it("lets the user retry a failed load", async () => {
    const retry = vi.fn();
    standings.mockReturnValue({ ...failed("Can't reach the server."), retry });
    render(<SeasonArchive initialYear={2024} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("SeasonArchive calendar", () => {
  const openCalendar = async () => userEvent.click(screen.getByRole("tab", { name: "Calendar" }));

  it("lists the season's races with their rounds", async () => {
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    expect(screen.getByRole("button", { name: /Bahrain Grand Prix/ })).toBeInTheDocument();
    expect(screen.getByText("Saudi Arabian Grand Prix")).toBeInTheDocument();
  });

  it("marks a race that hasn't happened and doesn't open it", async () => {
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Australian Grand Prix/ })).not.toBeInTheDocument();
  });

  it("shows a race's classification when it is opened, and asks for that round", async () => {
    results.mockReturnValue(ready(RESULTS));
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    await userEvent.click(screen.getByRole("button", { name: /Bahrain Grand Prix/ }));
    expect(results).toHaveBeenLastCalledWith(2024, 1);
    const table = screen.getByRole("table", { name: /classification/i });
    expect(within(table).getByText("Max Verstappen")).toBeInTheDocument();
    expect(within(table).getByText("1:31:44.742")).toBeInTheDocument();   // winner's race time
    expect(within(table).getByText("+22.457")).toBeInTheDocument();       // gap to the winner
    expect(within(table).getByText("Lapped")).toBeInTheDocument();        // status when there's no gap
    expect(within(table).getByText("Engine")).toBeInTheDocument();
  });

  it("offers the map replay and head-to-head for the race", async () => {
    results.mockReturnValue(ready(RESULTS));
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    await userEvent.click(screen.getByRole("button", { name: /Bahrain Grand Prix/ }));
    expect(screen.getByRole("link", { name: /replay on the track map/i })).toHaveAttribute("href", "/map?year=2024&round=1");
    expect(screen.getByRole("link", { name: /compare drivers/i })).toHaveAttribute("href", "/compare?year=2024&round=1");
  });

  it("goes back to the calendar", async () => {
    results.mockReturnValue(ready(RESULTS));
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    await userEvent.click(screen.getByRole("button", { name: /Bahrain Grand Prix/ }));
    await userEvent.click(screen.getByRole("button", { name: /all races/i }));
    expect(screen.getByRole("button", { name: /Bahrain Grand Prix/ })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /classification/i })).not.toBeInTheDocument();
  });

  it("says when a race has no published results yet", async () => {
    results.mockReturnValue(failed("This race has no final classification yet.", true));
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    await userEvent.click(screen.getByRole("button", { name: /Bahrain Grand Prix/ }));
    expect(screen.getByText(/no results have been published/i)).toBeInTheDocument();
  });

  it("returns to the calendar when the season changes", async () => {
    results.mockReturnValue(ready(RESULTS));
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    await userEvent.click(screen.getByRole("button", { name: /Bahrain Grand Prix/ }));
    await userEvent.selectOptions(screen.getByLabelText("Season"), "2023");
    expect(calendar).toHaveBeenLastCalledWith(2023);
    expect(screen.queryByRole("table", { name: /classification/i })).not.toBeInTheDocument();
  });

  it("explains a calendar that failed to load", async () => {
    calendar.mockReturnValue(failed("Calendar unavailable."));
    render(<SeasonArchive initialYear={2024} />);
    await openCalendar();
    expect(screen.getByRole("alert")).toHaveTextContent("Calendar unavailable.");
  });
});
