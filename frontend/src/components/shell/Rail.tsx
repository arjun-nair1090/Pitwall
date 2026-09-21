"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, PanelLeftClose, PanelLeftOpen, Radio, Search } from "lucide-react";
import Kbd from "@/components/ui/Kbd";
import { useSeasonCalendar } from "@/hooks/useRaceData";
import { cn } from "@/lib/cn";
import { findModuleForPath, GROUP_ORDER, MODULES } from "@/lib/modules";
import { useRailCollapsed } from "@/lib/railState";
import { formatRaceDate, nextRace } from "@/lib/season";
import { usePaletteStore } from "@/store/usePaletteStore";
import { useF1Store } from "@/store/useTelemetryStore";

// The sidebar is an icon rail below 1024px and a full, labelled sidebar from 1024px, which can be
// collapsed to the rail. Its width comes from --rail-w and its labels from the rail-expanded:
// variant, both driven by <html data-rail>, so nothing depends on React having run yet. Labels stay
// in the page as screen-reader text while collapsed, so every link always has a name.
const LABEL = "sr-only lg:rail-expanded:not-sr-only whitespace-nowrap";
const TOOLTIP =
  "pointer-events-none absolute left-full top-1/2 z-40 ml-3 -translate-y-1/2 whitespace-nowrap rounded-control border border-gantry bg-raised px-2.5 py-1 text-xs font-medium text-chalk opacity-0 shadow-lg transition-opacity group-hover/item:opacity-100 group-focus-visible/item:opacity-100 lg:rail-expanded:hidden";

// Three bars of falling length: a position tower, the one shape every timing screen has in common.
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <rect x="0" y="2" width="20" height="4" rx="1" fill="currentColor" />
      <rect x="0" y="8" width="14" height="4" rx="1" fill="currentColor" />
      <rect x="0" y="14" width="8" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}

// What is happening right now: the running session, or else the next race on the calendar.
function StatusCard() {
  const live = useF1Store((s) => s.isConnected);
  const session = useF1Store((s) => s.activeSession);
  const calendar = useSeasonCalendar(new Date().getFullYear());
  const upcoming = calendar.status === "ready" ? nextRace(calendar.data) : null;
  if (!live && !upcoming) return null;

  const href = live ? "/live" : "/predictions";
  const heading = live ? "Live now" : "Next race";
  const title = live
    ? `${session?.circuit_short_name || session?.location || session?.country || "Session"} ${session?.session_name ?? ""}`.trim()
    : upcoming!.event_name;
  const note = live ? "Open live timing" : formatRaceDate(upcoming!.race_start_utc);
  const Icon = live ? Radio : CalendarClock;

  return (
    <Link
      href={href}
      className={cn(
        "group/item relative mx-2 mb-2 flex items-center justify-center rounded-control transition-colors hover:bg-raised",
        "lg:rail-expanded:justify-start lg:rail-expanded:gap-3 lg:rail-expanded:rounded-panel lg:rail-expanded:border lg:rail-expanded:border-gantry lg:rail-expanded:bg-kerb lg:rail-expanded:p-3 lg:rail-expanded:hover:bg-raised",
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center text-mute lg:rail-expanded:h-8 lg:rail-expanded:w-8 lg:rail-expanded:shrink-0 lg:rail-expanded:rounded-control lg:rail-expanded:bg-raised">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      {live && <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-live" />}
      <span className={cn("min-w-0", LABEL)}>
        <span className="flex items-center gap-1.5 text-xs font-medium text-mute">{heading}</span>
        <span className="block truncate text-sm font-semibold text-chalk">{title}</span>
        <span className="block text-xs text-mute">{note}</span>
      </span>
      <span aria-hidden className={TOOLTIP}>{heading}: {title}</span>
    </Link>
  );
}

export default function Rail() {
  const current = findModuleForPath(usePathname());
  const live = useF1Store((s) => s.isConnected);
  const openSearch = usePaletteStore((s) => s.setOpen);
  const [collapsed, setCollapsed] = useRailCollapsed();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-w)] flex-col border-r border-gantry bg-tarmac transition-[width] duration-200 motion-reduce:transition-none md:flex">
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col px-2 py-3 [@media(max-height:640px)]:overflow-y-auto">
        <Link
          href="/"
          aria-label="Pit Wall home"
          className="mb-3 flex h-11 items-center justify-center gap-3 rounded-control px-2 text-chalk transition-colors hover:bg-raised lg:rail-expanded:justify-start"
        >
          <Mark />
          <span aria-hidden className="hidden font-display text-2xl font-extrabold leading-none lg:rail-expanded:inline">Pit Wall</span>
        </Link>

        <button
          type="button"
          onClick={() => openSearch(true)}
          aria-keyshortcuts="Control+K"
          className="group/item relative mb-1 flex h-10 items-center justify-center gap-3 rounded-control border border-edge px-2 text-sm text-mute transition-colors hover:bg-raised hover:text-chalk lg:rail-expanded:justify-start lg:rail-expanded:px-3"
        >
          <Search aria-hidden className="h-4 w-4 shrink-0" />
          <span className={cn("flex-1 text-left", LABEL)}>Search</span>
          <Kbd className="hidden lg:rail-expanded:inline">Ctrl K</Kbd>
          <span aria-hidden className={TOOLTIP}>Search</span>
        </button>

        {GROUP_ORDER.map((group) => (
          <div key={group} role="group" aria-label={group} className="flex flex-col gap-0.5">
            {/* Expanded: the group's name. Collapsed: a divider, so the groups still read as groups. */}
            <p aria-hidden className="hidden px-2 pb-1 pt-5 text-xs font-medium text-faint lg:rail-expanded:block">{group}</p>
            <div aria-hidden className="mx-2 my-2 border-t border-gantry lg:rail-expanded:hidden" />
            {MODULES.filter((m) => m.group === group).map((m) => {
              const active = current?.id === m.id;
              const Icon = m.icon;
              return (
                <Link
                  key={m.id}
                  href={m.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group/item relative flex h-10 items-center justify-center gap-3 rounded-control px-1 text-sm transition-colors lg:rail-expanded:justify-start",
                    active ? "font-semibold text-chalk" : "font-medium text-mute hover:text-chalk",
                  )}
                >
                  {/* The icon sits in a tile: filled when this is the page you're on, like the highlighted row on a timing screen. */}
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-control transition-colors",
                      active ? "bg-chalk text-tarmac" : "group-hover/item:bg-raised",
                    )}
                  >
                    <Icon aria-hidden className="h-[18px] w-[18px]" />
                  </span>
                  <span className={LABEL}>{m.label}</span>
                  {live && m.id === "live" && (
                    <>
                      <span className="sr-only"> (live now)</span>
                      <span aria-hidden className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-live lg:rail-expanded:static lg:rail-expanded:ml-auto lg:rail-expanded:mr-2" />
                    </>
                  )}
                  <span aria-hidden className={TOOLTIP}>{m.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <StatusCard />

      <div className="hidden border-t border-gantry p-2 lg:block">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed(!collapsed)}
          className="group/item relative flex h-10 w-full items-center justify-center gap-3 rounded-control px-1 text-sm font-medium text-mute transition-colors hover:text-chalk lg:rail-expanded:justify-start"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control group-hover/item:bg-raised">
            {collapsed ? <PanelLeftOpen aria-hidden className="h-[18px] w-[18px]" /> : <PanelLeftClose aria-hidden className="h-[18px] w-[18px]" />}
          </span>
          <span aria-hidden className="hidden lg:rail-expanded:inline">Collapse</span>
          <span aria-hidden className={TOOLTIP}>Expand sidebar</span>
        </button>
      </div>
    </aside>
  );
}
