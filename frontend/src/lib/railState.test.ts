import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAIL_INIT_SCRIPT, RAIL_KEY } from "./railScript";
import { isRailCollapsed, setRailCollapsed, subscribeRail } from "./railState";

beforeEach(() => {
  delete document.documentElement.dataset.rail;
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("railState", () => {
  it("starts expanded", () => {
    expect(isRailCollapsed()).toBe(false);
  });

  it("collapses by marking the page, so CSS can react before any script runs", () => {
    setRailCollapsed(true);
    expect(document.documentElement.dataset.rail).toBe("collapsed");
    expect(isRailCollapsed()).toBe(true);
  });

  it("expands by removing the mark", () => {
    setRailCollapsed(true);
    setRailCollapsed(false);
    expect(document.documentElement.dataset.rail).toBeUndefined();
    expect(isRailCollapsed()).toBe(false);
  });

  it("remembers the choice", () => {
    setRailCollapsed(true);
    expect(localStorage.getItem(RAIL_KEY)).toBe("collapsed");
    setRailCollapsed(false);
    expect(localStorage.getItem(RAIL_KEY)).toBe("expanded");
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setRailCollapsed(true)).not.toThrow();
    expect(isRailCollapsed()).toBe(true);
  });

  it("tells subscribers when it changes, and stops when they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRail(listener);
    setRailCollapsed(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setRailCollapsed(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  describe("the script that runs before the page paints", () => {
    const run = () => new Function(RAIL_INIT_SCRIPT)();

    it("restores a collapsed sidebar", () => {
      localStorage.setItem(RAIL_KEY, "collapsed");
      run();
      expect(document.documentElement.dataset.rail).toBe("collapsed");
    });

    it("leaves the sidebar expanded when nothing was saved, or it was left expanded", () => {
      run();
      expect(document.documentElement.dataset.rail).toBeUndefined();
      localStorage.setItem(RAIL_KEY, "expanded");
      run();
      expect(document.documentElement.dataset.rail).toBeUndefined();
    });

    it("does nothing when storage can't be read", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
      expect(run).not.toThrow();
      expect(document.documentElement.dataset.rail).toBeUndefined();
    });
  });
});
