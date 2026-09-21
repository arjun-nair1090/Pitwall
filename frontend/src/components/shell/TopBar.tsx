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
import Wordmark, { Mark } from "./Wordmark";

// The strip across the top of a broadcast feed: where we are, what the weather is doing, and
// whether the session is on air. The red rule under it is the frame the whole product sits in.
export default function TopBar() {
  const { activeSession, isConnected, apiStatus, weather } = useF1Store();
  const setOpen = usePaletteStore((s) => s.setOpen);
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform)) setModKey("⌘");
  }, []);

  const offline = apiStatus === "unreachable";

  return (
    <header className="sticky top-0 z-20 flex min-h-12 items-center gap-3 border-b-2 border-live bg-tarmac/95 px-4 backdrop-blur md:px-6">
      <Link href="/" aria-label="Pit Wall home" className="flex items-center gap-2 text-chalk md:hidden">
        <Mark className="h-4 w-[18px]" />
        <Wordmark className="text-xl" />
      </Link>

      <p className="hidden min-w-0 truncate text-sm md:block">
        {activeSession ? (
          <>
            <span className="font-display font-bold uppercase tracking-[0.06em] text-chalk">{activeSession.circuit_short_name}</span>
            <span aria-hidden className="mx-2 text-gantry">/</span>
            <span className="font-display uppercase tracking-[0.04em] text-mute">{activeSession.session_name}, {activeSession.year}</span>
          </>
        ) : offline ? (
          <span role="alert" className="text-live-text">Can't reach the API. Check that the backend is running.</span>
        ) : (
          <span className="text-mute">{apiStatus === "ok" ? "No live session right now" : "Checking for a live session…"}</span>
        )}
      </p>

      <div className="ml-auto flex items-center gap-3">
        {weather && (
          <p className="hidden items-center gap-3 font-display text-[11px] font-semibold uppercase tracking-[0.08em] tabular-nums text-mute lg:flex">
            <span>Air <span className="text-chalk">{weather.air_temperature}°</span></span>
            <span>Track <span className="text-chalk">{weather.track_temperature}°</span></span>
            <span className="text-chalk">{weather.rainfall === 1 ? "Wet" : "Dry"}</span>
          </p>
        )}

        {/* On air: a solid red block, the way a live feed marks itself. Everything else is quiet. */}
        {isConnected ? (
          <span className="flex items-center gap-1.5 rounded-control bg-live px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Live
          </span>
        ) : (
          <span className={cn("flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em]", offline ? "text-live-text" : "text-faint")}>
            <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", offline ? "bg-live" : "border border-faint")} />
            {offline ? "API offline" : apiStatus === "ok" ? "Standby" : "Connecting…"}
          </span>
        )}

        {offline && (
          <Button size="sm" variant="ghost" aria-label="Retry connection" onClick={() => window.location.reload()}>
            Retry
          </Button>
        )}
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
