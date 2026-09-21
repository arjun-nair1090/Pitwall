import { renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearReplayCache, useReplayLap } from "./useReplayLap";

vi.mock("axios");
const get = vi.mocked(axios.get);
const lap = (n: number) => ({ data: { lap: n, total_laps: 44, drivers: [], order: [], outline: { x: [], y: [] } } });

beforeEach(() => {
  get.mockReset().mockImplementation(async (_url, config: any) => lap(config.params.lap_number));
  clearReplayCache();
});

describe("useReplayLap", () => {
  it("stays idle until a race is chosen", () => {
    const { result } = renderHook(() => useReplayLap(2024, null, 1, 44));
    expect(result.current.status).toBe("idle");
    expect(get).not.toHaveBeenCalled();
  });

  it("loads the lap for the round", async () => {
    const { result } = renderHook(() => useReplayLap(2024, 14, 3, 44));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(get).toHaveBeenCalledWith("/api/v1/telemetry/replay", { params: { year: 2024, round: 14, lap_number: 3 } });
    expect(result.current.status === "ready" && result.current.data.lap).toBe(3);
  });

  it("fetches the next lap in the background so playback doesn't stall at the line", async () => {
    const { result } = renderHook(() => useReplayLap(2024, 14, 3, 44));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get.mock.calls[1][1]).toEqual({ params: { year: 2024, round: 14, lap_number: 4 } });
  });

  it("uses the prefetched lap instead of asking again", async () => {
    const { result, rerender } = renderHook(({ n }) => useReplayLap(2024, 14, n, 44), { initialProps: { n: 3 } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    rerender({ n: 4 });
    await waitFor(() => expect(result.current.status === "ready" && result.current.data.lap).toBe(4));
    expect(get.mock.calls.filter((c: any) => c[1].params.lap_number === 4)).toHaveLength(1);
  });

  it("doesn't look past the last lap", async () => {
    const { result } = renderHook(() => useReplayLap(2024, 14, 44, 44));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await new Promise((r) => setTimeout(r, 30));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure, so trying again really asks again", async () => {
    get.mockRejectedValueOnce({ response: { status: 502, data: { detail: "Couldn't load the replay right now. Try again shortly." } } });
    const { result } = renderHook(() => useReplayLap(2024, 14, 3, 44));
    await waitFor(() => expect(result.current.status).toBe("error"));
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("keeps races apart", async () => {
    const { rerender, result } = renderHook(({ r }) => useReplayLap(2024, r, 1, 44), { initialProps: { r: 14 } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ r: 15 });
    await waitFor(() => expect(get.mock.calls.some((c: any) => c[1].params.round === 15)).toBe(true));
  });
});
