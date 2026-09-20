import type { Metadata } from "next";
import AppInitializer from "@/components/AppInitializer";
import NavigationBar from "@/components/NavigationBar";
import BackgroundScene from "@/components/BackgroundScene";
import LiveAlertBanner from "@/components/LiveAlertBanner";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (see src/fonts/) instead of next/font/google: the Google Fonts fetch
// at `next build` time has no fallback and hard-fails the build on flaky/blocked
// networks (corporate proxies, some CI/Docker build contexts).
const titillium = localFont({
  src: [
    { path: "../fonts/TitilliumWeb-200.woff2", weight: "200", style: "normal" },
    { path: "../fonts/TitilliumWeb-300.woff2", weight: "300", style: "normal" },
    { path: "../fonts/TitilliumWeb-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/TitilliumWeb-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/TitilliumWeb-700.woff2", weight: "700", style: "normal" },
    { path: "../fonts/TitilliumWeb-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-titillium",
  display: "swap",
});

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
    <html lang="en" className={`${titillium.variable}`}>
      <body className="bg-black text-white font-titillium antialiased">
        <AppInitializer>
          <div className="relative min-h-screen w-full overflow-hidden">
            {/* Background layer: animated 3D hero on landing, flat background elsewhere */}
            <BackgroundScene />

            <LiveAlertBanner />

            {/* The UI Layer */}
            <div className="relative z-10 min-h-screen p-4 flex flex-col">
              <NavigationBar />
              <main className="flex-1 flex flex-col">
                {children}
              </main>
            </div>
          </div>
        </AppInitializer>
      </body>
    </html>
  );
}
