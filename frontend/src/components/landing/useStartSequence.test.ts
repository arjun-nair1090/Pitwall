import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStartSequence } from "./useStartSequence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Each timer is scheduled by an effect after the previous state update, so advance one step per act().
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const opts = { lightMs: 100, holdMs: 200, afterMs: 300 };

describe("useStartSequence", () => {
  it("lights the five lamps one at a time, holds, goes, then finishes", () => {
    const { result } = renderHook(() => useStartSequence({ instant: false, ...opts }));
    expect(result.current).toMatchObject({ lit: 0, stage: "lights" });
    for (let i = 1; i <= 5; i++) {
      tick(100);
      expect(result.current.lit).toBe(i);
    }
    tick(199);
    expect(result.current).toMatchObject({ lit: 5, stage: "lights" });
    tick(1);
    expect(result.current).toMatchObject({ lit: 0, stage: "go" });
    tick(300);
    expect(result.current.stage).toBe("done");
  });
  it("is done immediately when instant", () => {
    const { result } = renderHook(() => useStartSequence({ instant: true, ...opts }));
    expect(result.current).toMatchObject({ lit: 0, stage: "done" });
  });
  it("can be skipped mid-sequence", () => {
    const { result } = renderHook(() => useStartSequence({ instant: false, ...opts }));
    tick(100);
    act(() => result.current.skip());
    expect(result.current).toMatchObject({ lit: 0, stage: "done" });
    tick(1000);
    expect(result.current.stage).toBe("done");
  });
});
