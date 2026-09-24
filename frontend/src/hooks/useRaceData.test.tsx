import { renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCalendarCache, useRaceResults, useSeasonCalendar, useSeasonRaces, useSessionInfo, useStandings } from "./useRaceData";

vi.mock("axios");
const get = vi.mocked(axios.get);

const calendar = [
  { round: 2, country: "China", location: "Shanghai", event_name: "Chinese Grand Prix", race_start_utc: "2020-03-15T07:00:00Z", sessions: ["FP1", "Q", "R"] },
  { round: 1, country: "Australia", location: "Melbourne", event_name: "Australian Grand Prix", race_start_utc: "2020-03-08T04:00:00Z" },
  { round: 3, country: "Nowhere", location: "Later", event_name: "Future Grand Prix", race_start_utc: "2999-01-01T00:00:00Z" },
];

beforeEach(() => {
  get.mockReset();
  clearCalendarCache();
});

describe("useSeasonRaces", () => {
  it("lists only completed races, in season order", async () => {
    get.mockResolvedValue({ data: calendar });
    const { result } = renderHook(() => useSeasonRaces(2020));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const races = result.current.status === "ready" ? result.current.data : [];
    expect(races.map((r) => r.event_name)).toEqual(["Australian Grand Prix", "Chinese Grand Prix"]);
    expect(get).toHaveBeenCalledWith("/api/v1/races/historical", { params: { year: 2020 } });
  });

  it("reuses a season it has already loaded", async () => {
    get.mockResolvedValue({ data: calendar });
    const first = renderHook(() => useSeasonRaces(2020));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    const second = renderHook(() => useSeasonRaces(2020));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("loads a different season separately", async () => {
    get.mockResolvedValue({ data: calendar });
    const { rerender, result } = renderHook(({ y }) => useSeasonRaces(y), { initialProps: { y: 2020 } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ y: 2019 });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("reports a failed load with a way to retry", async () => {
    get.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Calendar unavailable." } } });
    get.mockResolvedValueOnce({ data: calendar });
    const { result } = renderHook(() => useSeasonRaces(2020));
    await waitFor(() => expect(result.current.status).toBe("error"));
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});

describe("useSessionInfo", () => {
  const info = { year: 2020, round: 2, event_name: "Chinese Grand Prix", session: "R", total_laps: 56, drivers: [] };

  it("stays idle until a round is chosen", () => {
    const { result } = renderHook(() => useSessionInfo(2020, null, "R"));
    expect(result.current.status).toBe("idle");
    expect(get).not.toHaveBeenCalled();
  });

  it("asks for the round and session and reports the race distance", async () => {
    get.mockResolvedValue({ data: info });
    const { result } = renderHook(() => useSessionInfo(2020, 2, "R"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(get).toHaveBeenCalledWith("/api/v1/races/session-info", { params: { year: 2020, round: 2, session: "R" } });
    expect(result.current.status === "ready" && result.current.data.total_laps).toBe(56);
  });

  it("reloads when the session changes", async () => {
    get.mockResolvedValue({ data: info });
    const { rerender, result } = renderHook(({ s }) => useSessionInfo(2020, 2, s), { initialProps: { s: "R" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ s: "Q" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe("useSeasonCalendar", () => {
  it("returns every race, including ones still to come", async () => {
    get.mockResolvedValue({ data: calendar });
    const { result } = renderHook(() => useSeasonCalendar(2020));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.status === "ready" && result.current.data).toHaveLength(3);
  });
});

describe("useStandings", () => {
  it("loads the season's standings", async () => {
    get.mockResolvedValue({ data: { year: 2020, driver_standings: [], constructor_standings: [] } });
    const { result } = renderHook(() => useStandings(2020));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(get).toHaveBeenCalledWith("/api/v1/stats/standings", { params: { year: 2020 } });
  });

  it("reports the API's own message when a season has no standings", async () => {
    get.mockRejectedValue({ response: { status: 400, data: { detail: "No standings data available for this year." } } });
    const { result } = renderHook(() => useStandings(2030));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ message: "No standings data available for this year." });
  });
});

describe("useRaceResults", () => {
  it("stays idle until a round is chosen", () => {
    const { result } = renderHook(() => useRaceResults(2020, null));
    expect(result.current.status).toBe("idle");
  });

  it("loads a race's classification", async () => {
    get.mockResolvedValue({ data: { year: 2020, round: 2, classification: [] } });
    const { result } = renderHook(() => useRaceResults(2020, 2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(get).toHaveBeenCalledWith("/api/v1/races/results", { params: { year: 2020, round: 2 } });
  });

  it("flags a race that has no published results as not found", async () => {
    get.mockRejectedValue({ response: { status: 404, data: { detail: "This race has no final classification yet." } } });
    const { result } = renderHook(() => useRaceResults(2020, 2));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ notFound: true });
  });
});
