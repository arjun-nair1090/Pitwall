// Set API_PROXY_TARGET (e.g. https://pitwall.duckdns.org) to forward /api/* to the backend, so the
// browser only talks to this site and the backend's login cookies work on a different domain.
const proxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");

// The live-timing socket connects to the backend directly and team radio streams from F1's CDN; everything
// else comes from this site. Next.js inlines its hydration scripts, hence 'unsafe-inline'.
const backend = proxyTarget ?? process.env.NEXT_PUBLIC_API_URL ?? "";
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  ["connect-src 'self'", backend, backend.replace(/^http/, "ws")].filter(Boolean).join(" "),
  "media-src 'self' https://livetiming.formula1.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  env: proxyTarget ? { NEXT_PUBLIC_API_PROXY_TARGET: proxyTarget } : {},
  async headers() {
    // `next dev` needs eval for hot reload, which this CSP forbids. Vercel adds HSTS itself.
    if (process.env.NODE_ENV === "development") return [];
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: CSP },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  async rewrites() {
    return proxyTarget ? [{ source: "/api/:path*", destination: `${proxyTarget}/api/:path*` }] : [];
  },
};

export default nextConfig;
