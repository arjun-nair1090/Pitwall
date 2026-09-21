import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsync } from "./useAsync";

describe("useAsync", () => {
  it("is idle until it has something to load", () => {
    const { result } = renderHook(() => useAsync(null, "none"));
    expect(result.current.status).toBe("idle");
  });

  it("loads, then reports the data", async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve(42), "k"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.status === "ready" && result.current.data).toBe(42);
  });

  it("reports a failure with the message from the error mapper", async () => {
    const { result } = renderHook(() =>
      useAsync(() => Promise.reject({ response: { status: 404, data: { detail: "No such race." } } }), "k"),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ status: "error", message: "No such race.", notFound: true });
  });

  it("reloads when the key changes and ignores a slower earlier request", async () => {
    let resolveFirst: (v: string) => void = () => {};
    const loaders: Record<string, () => Promise<string>> = {
      a: () => new Promise((r) => { resolveFirst = r; }),
      b: () => Promise.resolve("B"),
    };
    const { result, rerender } = renderHook(({ k }) => useAsync(loaders[k], k), { initialProps: { k: "a" } });
    rerender({ k: "b" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => resolveFirst("A"));  // the stale response arrives late
    expect(result.current.status === "ready" && result.current.data).toBe("B");
  });

  it("goes back to idle when the loader is removed", async () => {
    const { result, rerender } = renderHook(({ on }) => useAsync(on ? () => Promise.resolve(1) : null, on ? "on" : "off"), { initialProps: { on: true } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ on: false });
    expect(result.current.status).toBe("idle");
  });

  it("retries the same request on demand", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useAsync(load, "k"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
