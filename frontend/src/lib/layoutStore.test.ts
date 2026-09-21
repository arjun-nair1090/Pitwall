import { describe, expect, it } from "vitest";
import { loadLayouts, resetLayouts, saveLayouts, type Layouts } from "./layoutStore";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const throwing = {
  getItem(): string | null { throw new Error("blocked"); },
  setItem(): void { throw new Error("blocked"); },
  removeItem(): void { throw new Error("blocked"); },
};

const defaults: Layouts = {
  lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }, { i: "b", x: 6, y: 0, w: 6, h: 4 }],
  sm: [{ i: "a", x: 0, y: 0, w: 1, h: 4 }, { i: "b", x: 0, y: 4, w: 1, h: 4 }],
};
const moved: Layouts = {
  lg: [{ i: "a", x: 0, y: 0, w: 8, h: 6 }, { i: "b", x: 8, y: 0, w: 4, h: 6 }],
  sm: defaults.sm,
};

describe("layoutStore", () => {
  it("returns the defaults when nothing is saved", () => {
    expect(loadLayouts("live", defaults, new MemoryStorage())).toEqual(defaults);
  });
  it("round-trips a saved layout", () => {
    const s = new MemoryStorage();
    saveLayouts("live", moved, s);
    expect(loadLayouts("live", defaults, s)).toEqual(moved);
  });
  it("keeps workspaces separate", () => {
    const s = new MemoryStorage();
    saveLayouts("live", moved, s);
    expect(loadLayouts("map", defaults, s)).toEqual(defaults);
  });
  it("ignores corrupted JSON", () => {
    const s = new MemoryStorage();
    s.setItem("pitwall.layout.v1.live", "{nope");
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("ignores an unknown version", () => {
    const s = new MemoryStorage();
    s.setItem("pitwall.layout.v1.live", JSON.stringify({ v: 99, layouts: moved }));
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("discards a layout whose panels no longer match the defaults", () => {
    const s = new MemoryStorage();
    saveLayouts("live", { lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }], sm: defaults.sm }, s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
    saveLayouts("live", { lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }, { i: "zzz", x: 6, y: 0, w: 6, h: 4 }], sm: defaults.sm }, s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("discards a layout with invalid numbers", () => {
    const s = new MemoryStorage();
    saveLayouts("live", { lg: [{ i: "a", x: -1, y: 0, w: 6, h: 4 }, { i: "b", x: 6, y: 0, w: 0, h: 4 }], sm: defaults.sm }, s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("only returns the breakpoints the defaults define", () => {
    const s = new MemoryStorage();
    saveLayouts("live", { ...moved, xl: moved.lg }, s);
    expect(Object.keys(loadLayouts("live", defaults, s)).sort()).toEqual(["lg", "sm"]);
  });
  it("survives storage that throws", () => {
    expect(loadLayouts("live", defaults, throwing)).toEqual(defaults);
    expect(() => saveLayouts("live", moved, throwing)).not.toThrow();
    expect(() => resetLayouts("live", throwing)).not.toThrow();
  });
  it("resets to the defaults", () => {
    const s = new MemoryStorage();
    saveLayouts("live", moved, s);
    resetLayouts("live", s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
});
