import { describe, expect, it } from "vitest";
import { fieldBests, mergeBests } from "./sessionBests";

describe("mergeBests", () => {
  it("keeps the lower positive value per key", () => {
    expect(mergeBests({ lap: 90, s1: 30 }, { lap: 89.5, s1: 31 })).toEqual({ lap: 89.5, s1: 30 });
  });
  it("adopts a value the previous bests did not have", () => {
    expect(mergeBests({}, { lap: 90, s2: 28 })).toEqual({ lap: 90, s2: 28 });
  });
  it("ignores missing, zero, negative and NaN values", () => {
    expect(mergeBests({ lap: 90 }, { lap: undefined, s1: 0, s2: -1, s3: NaN })).toEqual({ lap: 90 });
  });
  it("does not mutate its inputs", () => {
    const prev = { lap: 90 };
    mergeBests(prev, { lap: 80 });
    expect(prev).toEqual({ lap: 90 });
  });
});

describe("fieldBests", () => {
  it("takes the fastest value per key across drivers", () => {
    expect(fieldBests([{ lap: 90, s1: 30 }, { lap: 89, s1: 31, s2: 27 }])).toEqual({ lap: 89, s1: 30, s2: 27 });
  });
  it("is empty for an empty field", () => {
    expect(fieldBests([])).toEqual({});
  });
});
