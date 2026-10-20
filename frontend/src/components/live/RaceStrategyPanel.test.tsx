import { act, render, screen } from "@testing-library/react";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REFRESH_MS } from "@/components/AppInitializer";
import type { RaceStrategy } from "@/lib/raceStrategy";
import { useF1Store } from "@/store/useTelemetryStore";
import RaceStrategyPanel from "./RaceStrategyPanel";

vi.mock("axios");
const get = vi.mocked(axios.get);

const RACE: RaceStrategy = {
  live: true,
  applicable: true,
  lap: 21,
  total_laps: 62,
  laps_remaining: 42,
  neutralised: false,
  pit_loss: 23.1,
  pit_loss_source: "measured",
  battles: [
    { ahead: { number: 16, code: "LEC" }, behind: { number: 12, code: "ANT" }, gap: 0.6, closing: 0.1, laps_compared: 5, in_drs: true, laps_to_drs: null },
    { ahead: { number: 1, code: "NOR" }, behind: { number: 81, code: "PIA" }, gap: 2.4, closing: 0.35, laps_compared: 5, in_drs: false, laps_to_drs: 4 },
  ],
  pit_stops: [
    {
      number: 3, code: "VER", position: 1, rejoin_position: 3, positions_lost: 2,
      ahead: { code: "ANT", gap: 1.0 }, behind: { code: "NOR", gap: 8.0 }, traffic: true,
      status: "window opens", window: { open: 28, close: 33 }, early: true,
    },
  ],
  pit_duels: [
    {
      chaser: { number: 16, code: "LEC" }, leader: { number: 3, code: "VER" }, gap: 1.2,
      undercut: { gain: 2.0, margin: 0.8, verdict: "likely", compound: "HARD" },
      overcut: { gain: 0.4, margin: -0.8, verdict: "unlikely", compound: "HARD" },
    },
  ],
};

const respond = (data: RaceStrategy) => get.mockResolvedValue({ data } as never);

beforeEach(() => {
  get.mockReset();
  useF1Store.setState({ activeSession: { session_key: 11396, live: true } } as never);
});

afterEach(() => vi.useRealTimers());

describe("RaceStrategyPanel", () => {
  it("shows the battles, where each car would rejoin and the undercut odds", async () => {
    respond(RACE);
    render(<RaceStrategyPanel />);
    expect(await screen.findByText("ANT on LEC")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/sessions/11396/race-strategy");
    expect(screen.getByText("In DRS now")).toBeInTheDocument();
    expect(screen.getByText("DRS in ~4 laps")).toBeInTheDocument();
    expect(screen.getByText("closing 0.35 s/lap")).toBeInTheDocument();
    expect(screen.getByText("→ P3, 2 lost")).toBeInTheDocument();
    expect(screen.getByText("1.0 s behind ANT, 8.0 s ahead of NOR")).toBeInTheDocument();
    expect(screen.getByText("Traffic")).toBeInTheDocument();
    expect(screen.getByText("Window opens lap 28–33 (early estimate)")).toBeInTheDocument();
    expect(screen.getByText(/Pit loss 23\.1 s, measured in this race/)).toBeInTheDocument();
    expect(screen.getByText("Likely")).toBeInTheDocument();
    expect(screen.getByText("by 0.8 s")).toBeInTheDocument();
    expect(screen.getByText("short by 0.8 s")).toBeInTheDocument();
  });

  it("refreshes with the live timing", async () => {
    vi.useFakeTimers();
    respond(RACE);
    render(<RaceStrategyPanel />);
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(LIVE_REFRESH_MS));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("says so behind a safety car", async () => {
    respond({ ...RACE, neutralised: true, battles: [] });
    render(<RaceStrategyPanel />);
    expect(await screen.findByText(/Safety car or VSC/)).toBeInTheDocument();
  });

  it("waits for a race when no session is live, without asking the server", () => {
    useF1Store.setState({ activeSession: { session_key: 11388, live: false } } as never);
    render(<RaceStrategyPanel />);
    expect(screen.getByText("No race is live")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("has nothing to forecast in qualifying", async () => {
    respond({ live: true, applicable: false, session_name: "Qualifying" });
    render(<RaceStrategyPanel />);
    expect(await screen.findByText("Nothing to forecast in Qualifying")).toBeInTheDocument();
  });

  it("treats a session the live feed doesn't carry as not live", async () => {
    respond({ live: false });
    render(<RaceStrategyPanel />);
    expect(await screen.findByText("No race is live")).toBeInTheDocument();
  });
});
