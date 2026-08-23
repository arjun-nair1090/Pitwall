import type { Metadata } from "next";
import dynamic from "next/dynamic";
import AppInitializer from "@/components/AppInitializer";
import NavigationBar from "@/components/NavigationBar";
import { Titillium_Web } from "next/font/google";
import "./globals.css";

const titillium = Titillium_Web({
  weight: ["200", "300", "400", "600", "700", "900"],
  subsets: ["latin"],
  variable: "--font-titillium",
});

export const metadata: Metadata = {
  title: "F1 Pit Wall",
  description: "Real-time F1 telemetry dashboard",
};

// We use dynamic import because Three.js components often rely on browser-only APIs (window, etc.)
const RacingScene = dynamic(() => import("@/components/RacingScene"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen w-full bg-black text-white">
      <div className="animate-pulse text-xl font-mono tracking-widest uppercase">
        Initializing Telemetry...
      </div>
    </div>
  ),
});

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
            {/* The 3D Canvas Layer (Global Background) */}
            <div className="absolute inset-0 z-0 opacity-40">
              <RacingScene />
            </div>

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
