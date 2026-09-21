"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Kbd from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";
import { usePaletteStore } from "@/store/usePaletteStore";
import { useF1Store } from "@/store/useTelemetryStore";
import AccountControl from "./AccountControl";

export default function TopBar() {
  const { activeSession, isConnected, weather } = useF1Store();
  const setOpen = usePaletteStore((s) => s.setOpen);
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform)) setModKey("⌘");
  }, []);

  return (
    <header className="sticky top-0 z-20 flex min-h-12 items-center gap-3 border-b border-gantry bg-tarmac/90 px-4 backdrop-blur md:px-6">
      <Link href="/" className="font-display text-xl font-extrabold text-chalk md:hidden">Pit Wall</Link>

      <p className="hidden min-w-0 truncate text-sm md:block">
        {activeSession ? (
          <>
            <span className="font-semibold text-chalk">{activeSession.circuit_short_name}</span>{" "}
            <span className="text-mute">{activeSession.session_name}, {activeSession.year}</span>
          </>
        ) : (
          <span className="text-mute">Syncing sessions…</span>
        )}
      </p>

      <div className="ml-auto flex items-center gap-3">
        {weather && (
          <p className="hidden gap-3 text-xs tabular-nums text-mute lg:flex">
            <span>Air {weather.air_temperature}°</span>
            <span>Track {weather.track_temperature}°</span>
            <span>{weather.rainfall === 1 ? "Wet" : "Dry"}</span>
          </p>
        )}
        <span className="flex items-center gap-2 text-xs text-mute">
          <span aria-hidden className={cn("h-2 w-2 rounded-full", isConnected ? "animate-pulse bg-live" : "border border-faint")} />
          {isConnected ? "Live" : "Offline"}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K">
          <Search aria-hidden className="h-4 w-4" />
          <span className="hidden sm:inline">Search</span>
          <Kbd className="hidden md:inline">{modKey} K</Kbd>
        </Button>
        <AccountControl />
      </div>
    </header>
  );
}
