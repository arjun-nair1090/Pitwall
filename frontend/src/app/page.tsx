"use client";

import dynamic from "next/dynamic";
import DashboardOverlay from "@/components/DashboardOverlay";

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

export default function Home() {
  return (
    <main className="relative min-h-screen w-full bg-black overflow-hidden">
      {/* The 3D Canvas Layer */}
      <div className="absolute inset-0 z-0">
        <RacingScene />
      </div>

      {/* The UI/Dashboard Overlay Layer */}
      <div className="relative z-10">
        <DashboardOverlay />
      </div>
    </main>
  );
}
