import { NextResponse, type NextRequest } from "next/server";

// Forwards /api/* to the backend with the visitor's IP and a shared secret. Caddy trusts that IP only
// alongside the secret, so the backend rate limits each visitor rather than each Vercel server, and
// nobody calling the backend directly can claim someone else's IP.
export function middleware(req: NextRequest) {
  const target = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
  const secret = process.env.PROXY_SECRET;
  if (!target || !secret) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.delete("x-pitwall-client-ip");
  // Vercel sets x-forwarded-for to the visitor's address and overwrites any value they sent.
  const ip = req.ip ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) headers.set("x-pitwall-client-ip", ip);
  headers.set("x-pitwall-proxy", secret);
  return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, target), { request: { headers } });
}

export const config = { matcher: "/api/:path*" };
