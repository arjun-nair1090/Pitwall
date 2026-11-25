import type { Metadata, Viewport } from "next";
import AppInitializer from "@/components/AppInitializer";
import LiveAlertBanner from "@/components/LiveAlertBanner";
import AppShell from "@/components/shell/AppShell";
import localFont from "next/font/local";
import "@/design/tokens.css";
import "./globals.css";
import { RAIL_INIT_SCRIPT } from "@/lib/railScript";
import { SITE_URL } from "@/lib/site";

// Self-hosted (see src/fonts/) instead of next/font/google: the Google Fonts fetch at `next build`
// time has no fallback and hard-fails the build on flaky or blocked networks (corporate proxies,
// some CI/Docker build contexts).
// Titillium Web: the squared bowls and flat-cut terminals of Formula 1's own broadcast face, which
// is proprietary. It carries every headline, wordmark and position number.
const display = localFont({
  src: [
    { path: "../fonts/titillium-web-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/titillium-web-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../fonts/titillium-web-latin-900-normal.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const ui = localFont({
  src: [
    { path: "../fonts/barlow-semi-condensed-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/barlow-semi-condensed-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/barlow-semi-condensed-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/barlow-semi-condensed-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-ui",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const DESCRIPTION =
  "Pitwall: free, open-source F1 live timing, telemetry and race analysis for every Grand Prix since 2018.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Pitwall: F1 live timing and race analysis", template: "%s | Pitwall" },
  description: DESCRIPTION,
  applicationName: "Pitwall",
  keywords: ["Pitwall", "F1", "Formula 1", "live timing", "telemetry", "FastF1", "race analysis"],
  openGraph: { type: "website", siteName: "Pitwall", url: "/", title: "Pitwall", description: DESCRIPTION },
  twitter: { card: "summary", title: "Pitwall", description: DESCRIPTION },
  // Google Search Console ownership proof; removing it un-verifies the property.
  verification: { google: "RvRhfjx7hR80jnjH_bO0IwFSzHSpRD3D46f-KoJGIxY" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the script below sets data-rail on <html> before React hydrates.
    <html lang="en" className={`${display.variable} ${ui.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RAIL_INIT_SCRIPT }} />
      </head>
      <body className="bg-tarmac font-sans text-chalk antialiased">
        <AppInitializer>
          <LiveAlertBanner />
          <AppShell>{children}</AppShell>
        </AppInitializer>
      </body>
    </html>
  );
}
