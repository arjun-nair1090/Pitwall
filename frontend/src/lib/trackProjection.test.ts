import { describe, expect, it } from "vitest";
import { makeProjector } from "./trackProjection";

describe("makeProjector", () => {
  it("fits the track inside the box with the padding on every side", () => {
    const project = makeProjector([{ x: 0, y: 0 }, { x: 100, y: 100 }], 500, 50);
    expect(project({ x: 0, y: 0 })).toEqual({ x: 50, y: 450 });
    expect(project({ x: 100, y: 100 })).toEqual({ x: 450, y: 50 });
  });

  it("flips y, so north is up on screen", () => {
    const project = makeProjector([{ x: 0, y: 0 }, { x: 10, y: 10 }], 100, 0);
    expect(project({ x: 0, y: 10 }).y).toBeLessThan(project({ x: 0, y: 0 }).y);
  });

  it("keeps the track's proportions and centres a long thin one", () => {
    const project = makeProjector([{ x: 0, y: 0 }, { x: 200, y: 100 }], 400, 0);
    expect(project({ x: 0, y: 0 })).toEqual({ x: 0, y: 300 });
    expect(project({ x: 200, y: 100 })).toEqual({ x: 400, y: 100 });
  });

  it("copes with a single point or an empty track without producing NaN", () => {
    const one = makeProjector([{ x: 5, y: 5 }], 500, 50)({ x: 5, y: 5 });
    expect(Number.isFinite(one.x) && Number.isFinite(one.y)).toBe(true);
    const none = makeProjector([], 500, 50)({ x: 1, y: 2 });
    expect(Number.isFinite(none.x) && Number.isFinite(none.y)).toBe(true);
  });
});
