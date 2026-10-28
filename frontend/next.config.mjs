// Set API_PROXY_TARGET (e.g. https://pitwall.duckdns.org) to forward /api/* to the backend, so the
// browser only talks to this site and the backend's login cookies work on a different domain.
const proxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  env: proxyTarget ? { NEXT_PUBLIC_API_PROXY_TARGET: proxyTarget } : {},
  async rewrites() {
    return proxyTarget ? [{ source: "/api/:path*", destination: `${proxyTarget}/api/:path*` }] : [];
  },
};

export default nextConfig;
