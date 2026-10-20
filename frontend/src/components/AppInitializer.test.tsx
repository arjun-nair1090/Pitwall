import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useF1Store } from "@/store/useTelemetryStore";

const get = vi.fn();
vi.mock("axios", () => ({
  default: { get: (...args: unknown[]) => get(...args), defaults: {}, interceptors: { request: { use: vi.fn() } } },
}));

import AppInitializer, { LIVE_REFRESH_MS, SESSION_REFRESH_MS } from "./AppInitializer";

const FINISHED = { session_key: 11388, meeting_name: "Singapore Grand Prix", session_name: "Race", live: false };
const LIVE = { session_key: 11396, meeting_name: "United States Grand Prix", session_name: "Race", live: true };

function answer(session: object | null) {
  get.mockImplementation((url: string) => {
    if (url === "/api/v1/sessions/active") {
      return session ? Promise.resolve({ data: session }) : Promise.reject({ response: { status: 404 } });
    }
    if (url === "/api/v1/auth/me") return Promise.reject({ response: { status: 401 } });
    if (url.endsWith("/timing")) return Promise.resolve({ data: { "1": { position: 1, lap_number: 62 } } });
    return Promise.resolve({ data: [] });
  });
}

const calls = (suffix: string) => get.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  vi.stubGlobal("WebSocket", class { close() {} });
  useF1Store.setState({ activeSession: null, alerts: [], leaderboard: {}, apiStatus: "unknown" } as any);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AppInitializer", () => {
  it("loads a finished session without announcing it as live", async () => {
    answer(FINISHED);
    render(<AppInitializer>x</AppInitializer>);
    await flush();
    expect(useF1Store.getState().activeSession).toEqual(FINISHED);
    expect(useF1Store.getState().leaderboard["1"]).toBeDefined();
    expect(useF1Store.getState().alerts).toHaveLength(0);
    expect(useF1Store.getState().apiStatus).toBe("ok");
  });

  it("announces a live session", async () => {
    answer(LIVE);
    render(<AppInitializer>x</AppInitializer>);
    await flush();
    expect(useF1Store.getState().alerts.map((a) => a.message)).toEqual(["Session live: United States Grand Prix Race"]);
  });

  it("checks for a new session every so often, without refetching a finished session's data", async () => {
    answer(FINISHED);
    render(<AppInitializer>x</AppInitializer>);
    await flush();
    await act(async () => { vi.advanceTimersByTime(SESSION_REFRESH_MS); });
    await flush();
    expect(calls("/sessions/active")).toBe(2);
    expect(calls("/drivers")).toBe(1);
    expect(calls("/timing")).toBe(1);
  });

  it("picks up a session that goes live while the page is open", async () => {
    answer(FINISHED);
    render(<AppInitializer>x</AppInitializer>);
    await flush();
    answer(LIVE);
    await act(async () => { vi.advanceTimersByTime(SESSION_REFRESH_MS); });
    await flush();
    expect(useF1Store.getState().activeSession).toEqual(LIVE);
    expect(calls("/drivers")).toBe(2);
  });

  it("keeps the timing board fresh while a session is live", async () => {
    answer(LIVE);
    render(<AppInitializer>x</AppInitializer>);
    await flush();
    await act(async () => { vi.advanceTimersByTime(LIVE_REFRESH_MS); });
    await flush();
    expect(calls("/timing")).toBe(2);
    expect(calls("/drivers")).toBe(1);
  });

  it("clears the session when there is none", async () => {
    answer(FINISHED);
    render(<AppInitializer>x</AppInitializer>);
    await flush();
    answer(null);
    await act(async () => { vi.advanceTimersByTime(SESSION_REFRESH_MS); });
    await flush();
    expect(useF1Store.getState().activeSession).toBeNull();
    expect(useF1Store.getState().apiStatus).toBe("ok");
  });
});
