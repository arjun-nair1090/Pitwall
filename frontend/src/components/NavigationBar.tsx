"use client";

import React, { useState } from "react";
import axios from "axios";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useF1Store } from "@/store/useTelemetryStore";
import { Activity, Map, Archive, Radio, FlaskConical, GitCommit, Target, Newspaper, LogIn, LogOut } from "lucide-react";

export default function NavigationBar() {
  const pathname = usePathname();
  const { activeSession, isConnected, weather, currentUser, setCurrentUser } = useF1Store();
  const [logoutFailed, setLogoutFailed] = useState(false);

  const handleLogout = async () => {
    setLogoutFailed(false);
    try {
      await axios.post("/api/v1/auth/logout");
    } catch (err: any) {
      // 401 means the session was already gone server-side, so we're logged out
      // either way. Anything else (offline, server error) means the session may
      // still be live -- don't pretend otherwise.
      if (err?.response?.status !== 401) {
        setLogoutFailed(true);
        return;
      }
    }
    setCurrentUser(null);
  };

  const navLinks = [
    { name: "Live", path: "/live", icon: <Radio className="h-4 w-4" /> },
    { name: "Map", path: "/map", icon: <Map className="h-4 w-4" /> },
    { name: "Stats", path: "/stats", icon: <Archive className="h-4 w-4" /> },
    { name: "H2H", path: "/compare", icon: <Activity className="h-4 w-4" /> },
    { name: "Advanced", path: "/advanced", icon: <Activity className="h-4 w-4" /> },
    { name: "Strategy", path: "/strategy", icon: <FlaskConical className="h-4 w-4" /> },
    { name: "Debrief", path: "/debrief", icon: <Newspaper className="h-4 w-4" /> },
    { name: "Predictions", path: "/predictions", icon: <Target className="h-4 w-4" /> },
    { name: "Archives", path: "/archive", icon: <Archive className="h-4 w-4" /> },
  ];

  // Phones: logo, nav, status stacked. From md up: logo + status share the top row and
  // the nav takes a full-width second row, so the link list can grow without crowding.
  return (
    <header className="flex flex-col md:grid md:grid-cols-[1fr_auto] md:items-center gap-x-4 gap-y-3 mb-4 pb-3 border-b border-white/10 select-none">
      <div className="order-1 flex items-center justify-center md:justify-start gap-4">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <span className="text-xl font-bold tracking-widest text-white uppercase flex items-center gap-2">
            <span className="text-f1-red">F1</span> PIT WALL
          </span>
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

      <nav
        aria-label="Main"
        className="order-2 md:order-3 md:col-span-2 flex w-full max-w-full bg-white/5 border border-white/10 rounded overflow-x-auto p-0.5 scrollbar-none xl:justify-center"
      >
        {navLinks.map((link) => {
          const isActive = pathname === link.path;
          return (
            <Link
              key={link.path}
              href={link.path}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 px-3 md:px-4 py-2.5 md:py-1.5 text-xs font-bold uppercase whitespace-nowrap transition-colors rounded-sm ${
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
      <div className="order-3 md:order-2 md:justify-self-end flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-mono-f1">
        {weather && (
          <div className="flex items-center gap-3 text-white/60 text-[11px] md:border-r md:border-white/10 md:pr-4">
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
            <span className="sm:hidden">{isConnected ? "LIVE" : "OFFLINE"}</span>
            <span className="hidden sm:inline">{isConnected ? "TELEMETRY LINK STABLE" : "TELEMETRY DISCONNECTED"}</span>
          </span>
        </div>
        <Link
          href="/changelog"
          title="Changelog"
          className={`flex items-center gap-1.5 pl-4 border-l border-white/10 uppercase text-[11px] py-1.5 transition-colors ${
            pathname === "/changelog" ? "text-f1-red" : "text-white/40 hover:text-white/70"
          }`}
        >
          <GitCommit className="h-3.5 w-3.5" />
          Changelog
        </Link>
        {currentUser ? (
          <div className="flex items-center gap-3 pl-4 border-l border-white/10 text-[11px] uppercase">
            <span className="text-white/70 max-w-[120px] truncate" title={currentUser.email}>{currentUser.display_name}</span>
            <button
              onClick={handleLogout}
              className={`flex items-center gap-1.5 py-1.5 transition-colors ${logoutFailed ? "text-f1-red" : "text-white/40 hover:text-white/70"}`}
            >
              <LogOut className="h-3.5 w-3.5" />
              {logoutFailed ? "Retry logout" : "Log out"}
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className={`flex items-center gap-1.5 pl-4 border-l border-white/10 uppercase text-[11px] py-1.5 transition-colors ${
              pathname === "/login" ? "text-f1-red" : "text-white/40 hover:text-white/70"
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
