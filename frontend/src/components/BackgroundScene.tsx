"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// Three.js relies on browser-only APIs (window, WebGL context), so it must be
// dynamically imported with ssr disabled.
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

/**
 * The animated 3D scene is a hero moment for the landing page only. Data-dense
 * pages (stats, compare, archive, live, map, advanced) get a flat near-black
 * background instead, so charts/tables aren't competing with a moving backdrop.
 */
export default function BackgroundScene() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  if (!isLanding) {
    return <div className="absolute inset-0 z-0 bg-[#050506]" />;
  }

  return (
    <div className="absolute inset-0 z-0 opacity-40">
      <RacingScene />
    </div>
  );
}
