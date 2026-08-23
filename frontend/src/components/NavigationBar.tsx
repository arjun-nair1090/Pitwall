"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useF1Store } from "@/store/useTelemetryStore";
import { Activity, Map, Archive, Home } from "lucide-react";

export default function NavigationBar() {
  const pathname = usePathname();
  const { activeSession, isConnected, weather } = useF1Store();

  const navLinks = [
    { name: "Map", path: "/map", icon: <Map className="h-4 w-4" /> },
    { name: "Stats", path: "/stats", icon: <Archive className="h-4 w-4" /> },
    { name: "H2H", path: "/compare", icon: <Activity className="h-4 w-4" /> },
    { name: "Archives", path: "/archive", icon: <Archive className="h-4 w-4" /> },
  ];

  return (
    <header className="flex flex-col md:flex-row justify-between items-center mb-4 pb-3 border-b border-white/10 select-none">
      <div className="flex items-center gap-4 mb-4 md:mb-0">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <h1 className="text-xl font-bold tracking-widest text-white uppercase flex items-center gap-2">
            <span className="text-f1-red">F1</span> PIT WALL
          </h1>
        </Link>
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-[10px] bg-f1-red text-white font-bold px-1.5 py-0.5 rounded font-mono-f1 uppercase">
            RACE CONTROLLER
          </span>
          <span className="text-[10px] text-white/50 font-mono-f1">
            {activeSession ? `${activeSession.year} ${activeSession.circuit_short_name} - ${activeSession.session_name}` : "SYNCING SESSIONS..."}
          </span>
        </div>
      </div>

      <nav className="flex bg-white/5 border border-white/10 rounded overflow-hidden p-0.5 mx-4">
        {navLinks.map((link) => {
          const isActive = pathname === link.path;
          return (
            <Link
              key={link.path}
              href={link.path}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-bold uppercase transition-colors rounded-sm ${
                isActive ? "bg-f1-red text-white" : "text-white/40 hover:text-white"
              }`}
            >
              {link.icon}
              {link.name}
            </Link>
          );
        })}
      </nav>

      {/* Live status indicators */}
      <div className="flex items-center gap-4 text-xs font-mono-f1 mt-4 md:mt-0">
        {weather && (
          <div className="flex items-center gap-3 text-white/60 text-[11px] border-r border-white/10 pr-4">
            <span>AIR: {weather.air_temperature}°C</span>
            <span>TRACK: {weather.track_temperature}°C</span>
            <span>RAIN: {weather.rainfall === 1 ? "WET" : "DRY"}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isConnected ? "bg-f1-green animate-pulse" : "bg-f1-red animate-status-blink"
            }`}
          />
          <span className="uppercase text-[11px] text-white/70">
            {isConnected ? "TELEMETRY LINK STABLE" : "TELEMETRY DISCONNECTED"}
          </span>
        </div>
      </div>
    </header>
  );
}
