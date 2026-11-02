// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// next.config reads its env when imported, so each test imports a fresh copy.
async function headersFor(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { default: config } = await import("../next.config.mjs");
  const rules = await config.headers!();
  return Object.fromEntries(rules.flatMap((r: { headers: { key: string; value: string }[] }) => r.headers.map((h) => [h.key, h.value])));
}

describe("security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stop other sites framing the app and browsers guessing content types", async () => {
    const h = await headersFor({ API_PROXY_TARGET: "https://api.example/" });
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("let the live-timing socket reach the backend and team radio play from F1", async () => {
    const csp = (await headersFor({ API_PROXY_TARGET: "https://api.example/" }))["Content-Security-Policy"];
    expect(csp).toContain("connect-src 'self' https://api.example wss://api.example;");
    expect(csp).toContain("media-src 'self' https://livetiming.formula1.com");
    expect(csp).toContain("object-src 'none'");
  });

  it("are left off under next dev, which needs eval for hot reload", async () => {
    expect(await headersFor({ NODE_ENV: "development" })).toEqual({});
  });
});
