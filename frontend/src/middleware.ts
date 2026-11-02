import { NextResponse, type NextRequest } from "next/server";

// Forwards /api/* to the backend with the visitor's IP and a shared secret. Caddy trusts that IP only
// alongside the secret, so the backend rate limits each visitor rather than each Vercel server, and
// nobody calling the backend directly can claim someone else's IP.
export async function middleware(req: NextRequest) {
  const target = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
  const secret = process.env.PROXY_SECRET;
  if (!target || !secret) {
    const res = NextResponse.next();
    res.headers.set("x-pitwall-proxy-check", "missing");
    return res;
  }
  const headers = new Headers(req.headers);
  headers.delete("x-pitwall-client-ip");
  // Vercel sets x-forwarded-for to the visitor's address and overwrites any value they sent.
  const ip = req.ip ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) headers.set("x-pitwall-client-ip", ip);
  headers.set("x-pitwall-proxy", secret);
  const res = NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, target), { request: { headers } });
  // ponytail: temporary, to compare the deployed secret with the server's; remove once the proxy is confirmed.
  res.headers.set("x-pitwall-proxy-check", await fingerprint(secret));
  return res;
}

// The first 8 hex characters of the secret's SHA-256: enough to tell two values apart, useless for guessing it.
async function fingerprint(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const config = { matcher: "/api/:path*" };
