import { describe, expect, it } from "vitest";
import { INTRO_KEY, markIntroSeen, readIntroPreference } from "./introPreference";

function fakeWindow({ reduced = false, seen = false, broken = false } = {}) {
  const store = new Map<string, string>(seen ? [[INTRO_KEY, "1"]] : []);
  return {
    matchMedia: () => ({ matches: reduced }),
    sessionStorage: {
      getItem: (k: string) => { if (broken) throw new Error("blocked"); return store.get(k) ?? null; },
      setItem: (k: string, v: string) => { if (broken) throw new Error("blocked"); store.set(k, v); },
    },
    store,
  } as any;
}

describe("intro preference", () => {
  it("plays on a first visit", () => expect(readIntroPreference(fakeWindow())).toBe("play"));
  it("skips under reduced motion", () => expect(readIntroPreference(fakeWindow({ reduced: true }))).toBe("skip"));
  it("skips once seen this session", () => {
    const w = fakeWindow();
    markIntroSeen(w);
    expect(readIntroPreference(w)).toBe("skip");
  });
  it("plays (once per page view) when storage is blocked, and never throws", () => {
    const w = fakeWindow({ broken: true });
    expect(() => markIntroSeen(w)).not.toThrow();
    expect(readIntroPreference(w)).toBe("play");
  });
});
