// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

const request = (headers: Record<string, string> = {}) =>
  new NextRequest("https://pitwall.example/api/v1/auth/login?x=1", { method: "POST", headers });

describe("api proxy middleware", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("forwards to the backend with the secret and the visitor's IP", async () => {
    vi.stubEnv("API_PROXY_TARGET", "https://api.example/");
    vi.stubEnv("PROXY_SECRET", "s3cret");
    const res = await middleware(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://api.example/api/v1/auth/login?x=1");
    expect(res.headers.get("x-middleware-request-x-pitwall-proxy")).toBe("s3cret");
    expect(res.headers.get("x-middleware-request-x-pitwall-client-ip")).toBe("203.0.113.7");
  });

  it("drops a client-ip header the visitor sent when it can't tell their real IP", async () => {
    vi.stubEnv("API_PROXY_TARGET", "https://api.example");
    vi.stubEnv("PROXY_SECRET", "s3cret");
    const res = await middleware(request({ "x-pitwall-client-ip": "6.6.6.6" }));
    expect(res.headers.get("x-middleware-request-x-pitwall-client-ip")).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).not.toContain("x-pitwall-client-ip");
  });

  it("leaves requests alone without a secret, so next.config's plain rewrite still applies", async () => {
    vi.stubEnv("API_PROXY_TARGET", "https://api.example");
    vi.stubEnv("PROXY_SECRET", "");
    expect((await middleware(request())).headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("reports a fingerprint of the secret, so the deployed value can be compared with the server's", async () => {
    vi.stubEnv("API_PROXY_TARGET", "https://api.example");
    vi.stubEnv("PROXY_SECRET", "s3cret");
    // sha256("s3cret") starts 1ec1c26b
    expect((await middleware(request())).headers.get("x-pitwall-proxy-check")).toBe("1ec1c26b");
    vi.stubEnv("PROXY_SECRET", "");
    expect((await middleware(request())).headers.get("x-pitwall-proxy-check")).toBe("missing");
  });
});
