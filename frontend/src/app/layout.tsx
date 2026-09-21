import type { Metadata, Viewport } from "next";
import AppInitializer from "@/components/AppInitializer";
import LiveAlertBanner from "@/components/LiveAlertBanner";
import AppShell from "@/components/shell/AppShell";
import localFont from "next/font/local";
import "@/design/tokens.css";
import "./globals.css";

// Self-hosted (see src/fonts/) instead of next/font/google: the Google Fonts fetch at `next build`
// time has no fallback and hard-fails the build on flaky or blocked networks (corporate proxies,
// some CI/Docker build contexts).
const display = localFont({
  src: [
    { path: "../fonts/big-shoulders-display-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../fonts/big-shoulders-display-latin-800-normal.woff2", weight: "800", style: "normal" },
    { path: "../fonts/big-shoulders-display-latin-900-normal.woff2", weight: "900", style: "normal" },
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

export const metadata: Metadata = {
  title: "F1 Pit Wall",
  description: "Real-time F1 telemetry dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body className="bg-tarmac font-sans text-chalk antialiased">
        <AppInitializer>
          <LiveAlertBanner />
          <AppShell>{children}</AppShell>
        </AppInitializer>
      </body>
    </html>
  );
}
