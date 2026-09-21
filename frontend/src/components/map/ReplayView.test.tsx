import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReplayView from "./ReplayView";
import type { Race } from "@/lib/season";
import type { ReplayLap } from "@/lib/replay";

const replayHook = vi.fn();
const infoHook = vi.fn();
vi.mock("@/hooks/useReplayLap", () => ({ useReplayLap: (...a: unknown[]) => replayHook(...a) }));
vi.mock("@/hooks/useRaceData", () => ({
  useSeasonRaces: () => ({ status: "ready", data: [{ round: 14, country: "Belgium", location: "Spa", event_name: "Belgian Grand Prix", race_start_utc: "2024-07-28T13:00:00Z", sessions: ["R"] } satisfies Race], retry: vi.fn() }),
  useSessionInfo: (...a: unknown[]) => infoHook(...a),
}));

const frames = (n: number, base: number) => Array.from({ length: n }, (_, i) => base + i * 10);
const driver = (code: string, name: string, color: string, base: number, active = true) => ({
  code, number: code, name, team: `Team ${code}`, color, active,
  x: frames(5, base), y: frames(5, base), speed: [200, 210, 220, 230, 240], throttle: [100, 100, 90, 80, 70], brake: [0, 0, 1, 1, 0], gear: [5, 5, 4, 4, 5], rpm: [11000, 11000, 10500, 10500, 11000], drs: [0, 0, 0, 12, 12],
});
const lap = (n: number): ReplayLap => ({
  year: 2024, round: 14, event_name: "Belgian Grand Prix", lap: n, total_laps: 44, step: 0.5, duration: 2, frames: 5,
  drivers: [driver("HAM", "Lewis Hamilton", "#27F4D2", 0), driver("PIA", "Oscar Piastri", "#FF8000", 20), driver("ALO", "Fernando Alonso", "#229971", 40, false)],
  order: [
    { code: "HAM", position: 1, gap_to_leader: 0, lap_time: 108.2, compound: "MEDIUM", tyre_age: n, in_pit: false },
    { code: "PIA", position: 2, gap_to_leader: 3.4, lap_time: 108.9, compound: "HARD", tyre_age: n, in_pit: false },
  ],
  outline: { x: frames(20, 0), y: frames(20, 0).map((v) => (v % 40) * 2) },
});
const ready = (n: number) => ({ status: "ready", data: lap(n), retry: vi.fn() });
const initial = { year: 2024, round: 14, session: "R" as const, d1: null, d2: null };
const info = { status: "ready", data: { year: 2024, round: 14, event_name: "Belgian Grand Prix", session: "R", total_laps: 44, drivers: [] }, retry: vi.fn() };

beforeEach(() => {
  replayHook.mockReset().mockImplementation((_y, _r, n) => ready(n));
  infoHook.mockReset().mockReturnValue(info);
});

describe("ReplayView", () => {
  it("opens on lap 1 of the chosen race and shows how long the race is", () => {
    render(<ReplayView initial={initial} />);
    expect(replayHook).toHaveBeenCalledWith(2024, 14, 1, 44);
    expect(screen.getByLabelText("Lap")).toHaveValue("1");
    expect(within(screen.getByLabelText("Lap")).getAllByRole("option")).toHaveLength(44);
    expect(screen.getByText("of 44")).toBeInTheDocument();
  });

  it("shows every car still racing, and not one that has stopped", () => {
    render(<ReplayView initial={initial} />);
    expect(screen.getByRole("button", { name: "Select HAM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select PIA" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select ALO" })).not.toBeInTheDocument();
  });

  it("lists the order at the end of the lap with gaps", () => {
    render(<ReplayView initial={initial} />);
    expect(screen.getByRole("heading", { name: "Order at the end of lap 1" })).toBeInTheDocument();
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.getByText("+3.4 s")).toBeInTheDocument();
  });

  it("reads out a car's speed, gear and DRS when it is picked", async () => {
    render(<ReplayView initial={initial} />);
    expect(screen.getByText(/pick a car on the map/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Select PIA" }));
    expect(screen.getByRole("heading", { name: "Oscar Piastri" })).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();   // km/h at the start of the lap
    expect(screen.getByText(/rpm/)).toHaveTextContent("Gear 5, 11000 rpm, DRS closed");
  });

  it("steps to the next and previous lap", async () => {
    render(<ReplayView initial={initial} />);
    expect(screen.getByRole("button", { name: "Previous lap" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next lap" }));
    expect(replayHook).toHaveBeenLastCalledWith(2024, 14, 2, 44);
    expect(screen.getByLabelText("Lap")).toHaveValue("2");
    await userEvent.click(screen.getByRole("button", { name: "Previous lap" }));
    expect(screen.getByLabelText("Lap")).toHaveValue("1");
  });

  it("jumps to any lap", async () => {
    render(<ReplayView initial={initial} />);
    await userEvent.selectOptions(screen.getByLabelText("Lap"), "30");
    expect(replayHook).toHaveBeenLastCalledWith(2024, 14, 30, 44);
  });

  it("can't go past the last lap", async () => {
    render(<ReplayView initial={initial} />);
    await userEvent.selectOptions(screen.getByLabelText("Lap"), "44");
    expect(screen.getByRole("button", { name: "Next lap" })).toBeDisabled();
  });

  it("plays and pauses", async () => {
    render(<ReplayView initial={initial} />);
    const pause = screen.getByRole("button", { name: "Pause" });
    await userEvent.click(pause);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("offers real-time and faster playback", async () => {
    render(<ReplayView initial={initial} />);
    const speed = screen.getByRole("button", { name: /playback speed/i });
    expect(speed).toHaveTextContent("5x");
    await userEvent.click(speed);
    expect(speed).toHaveTextContent("10x");
  });

  it("says a lap is loading, rather than showing an empty map", () => {
    replayHook.mockReturnValue({ status: "loading", retry: vi.fn() });
    render(<ReplayView initial={initial} />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading lap 1/i);
  });

  it("explains a lap that couldn't be loaded, with a retry when it might work", async () => {
    const retry = vi.fn();
    replayHook.mockReturnValue({ status: "error", message: "Couldn't load the replay right now. Try again shortly.", notFound: false, retry });
    render(<ReplayView initial={initial} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the replay right now.");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  it("explains a race that couldn't be loaded", () => {
    infoHook.mockReturnValue({ status: "error", message: "There's no data for round 14 2024 yet.", notFound: true, retry: vi.fn() });
    render(<ReplayView initial={initial} />);
    expect(screen.getByRole("alert")).toHaveTextContent("There's no data for round 14 2024 yet.");
  });
});
