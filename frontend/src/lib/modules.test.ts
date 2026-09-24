import { describe, expect, it } from "vitest";
import { findModuleForPath, GROUP_ORDER, MODULES, searchModules } from "./modules";

describe("module registry", () => {
  it("has unique ids and unique absolute hrefs", () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.href)).size).toBe(MODULES.length);
    for (const m of MODULES) expect(m.href.startsWith("/")).toBe(true);
  });
  it("only uses declared groups", () => {
    for (const m of MODULES) expect(GROUP_ORDER).toContain(m.group);
  });
  it("marks exactly five modules for the mobile tab bar, each with a short label", () => {
    const primary = MODULES.filter((m) => m.mobilePrimary);
    expect(primary).toHaveLength(5);
    for (const m of primary) expect(m.shortLabel).toBeTruthy();
  });
  it("describes every module", () => {
    for (const m of MODULES) expect(m.description.length).toBeGreaterThan(10);
  });
});

describe("findModuleForPath", () => {
  it("matches exact paths", () => expect(findModuleForPath("/live")?.id).toBe("live"));
  it("matches nested paths by prefix", () => expect(findModuleForPath("/compare/x")?.id).toBe("compare"));
  it("does not match a longer sibling name", () => expect(findModuleForPath("/livestock")).toBeUndefined());
  it("returns undefined for the landing page and unknown routes", () => {
    expect(findModuleForPath("/")).toBeUndefined();
    expect(findModuleForPath("/drivers/VER")).toBeUndefined();
  });
});

describe("searchModules", () => {
  it("finds by title", () => expect(searchModules("live")[0].id).toBe("live"));
  it("finds by keyword", () => {
    expect(searchModules("h2h")[0].id).toBe("compare");
    expect(searchModules("tyre")[0].id).toBe("strategy");
  });
  it("returns nothing for gibberish", () => expect(searchModules("zzzz")).toEqual([]));
});
