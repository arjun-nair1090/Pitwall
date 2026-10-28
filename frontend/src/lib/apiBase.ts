// Set by next.config.mjs when API_PROXY_TARGET is: this site then forwards /api/* to the backend.
const proxyTarget = process.env.NEXT_PUBLIC_API_PROXY_TARGET;

// Where API requests go. Behind the proxy they stay on this site, so its login cookies are first-party.
export const API_BASE = proxyTarget ? "" : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// The live-timing socket can't go through the proxy, so it connects to the backend itself.
export const SOCKET_API_URL = proxyTarget || process.env.NEXT_PUBLIC_API_URL;
