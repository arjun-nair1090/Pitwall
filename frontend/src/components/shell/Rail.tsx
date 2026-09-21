"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { findModuleForPath, GROUP_ORDER, MODULES } from "@/lib/modules";
import { useRailCollapsed } from "@/lib/railState";
import { useF1Store } from "@/store/useTelemetryStore";

// The sidebar is an icon rail below 1024px and a full, labelled sidebar from 1024px, which can be
// collapsed to the rail. Its width comes from --rail-w and its labels from the rail-expanded:
// variant, both driven by <html data-rail>, so nothing depends on React having run yet. Labels stay
// in the page as screen-reader text while collapsed, so every link always has a name.
const LABEL = "sr-only lg:rail-expanded:not-sr-only whitespace-nowrap";

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

export default function Rail() {
  const current = findModuleForPath(usePathname());
  const live = useF1Store((s) => s.isConnected);
  const [collapsed, setCollapsed] = useRailCollapsed();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-w)] flex-col border-r border-gantry bg-tarmac transition-[width] duration-200 motion-reduce:transition-none md:flex">
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col px-2 py-3 [@media(max-height:640px)]:overflow-y-auto">
        <Link
          href="/"
          aria-label="Pit Wall home"
          className="mb-1 flex h-11 items-center justify-center gap-3 rounded-control px-3 text-chalk transition-colors hover:bg-raised lg:rail-expanded:justify-start"
        >
          <Mark />
          <span aria-hidden className="hidden font-display text-2xl font-extrabold leading-none lg:rail-expanded:inline">Pit Wall</span>
        </Link>

        {GROUP_ORDER.map((group, index) => (
          <div key={group} role="group" aria-label={group} className="flex flex-col gap-0.5">
            {/* Expanded: the group's name. Collapsed: a divider, so the groups still read as groups. */}
            <p aria-hidden className="hidden px-3 pb-1 pt-4 text-xs font-medium text-faint lg:rail-expanded:block">{group}</p>
            {index > 0 && <div aria-hidden className="mx-3 my-2 border-t border-gantry lg:rail-expanded:hidden" />}
            {MODULES.filter((m) => m.group === group).map((m) => {
              const active = current?.id === m.id;
              const Icon = m.icon;
              return (
                <Link
                  key={m.id}
                  href={m.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group/item relative flex h-10 items-center justify-center gap-3 rounded-control px-3 text-sm font-medium transition-colors lg:rail-expanded:justify-start",
                    active
                      ? "bg-raised text-chalk before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-chalk"
                      : "text-mute hover:bg-raised hover:text-chalk",
                  )}
                >
                  <Icon aria-hidden className="h-5 w-5 shrink-0" />
                  <span className={LABEL}>{m.label}</span>
                  {live && m.id === "live" && (
                    <>
                      <span className="sr-only"> (live now)</span>
                      <span aria-hidden className="absolute right-3 top-2 h-2 w-2 rounded-full bg-live lg:rail-expanded:static lg:rail-expanded:ml-auto" />
                    </>
                  )}
                  {/* Name on hover or focus while collapsed; the link already carries it for screen readers. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-full top-1/2 z-40 ml-3 -translate-y-1/2 whitespace-nowrap rounded-control border border-gantry bg-raised px-2.5 py-1 text-xs font-medium text-chalk opacity-0 shadow-lg transition-opacity group-hover/item:opacity-100 group-focus-visible/item:opacity-100 lg:rail-expanded:hidden"
                  >
                    {m.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="hidden border-t border-gantry p-2 lg:block">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed(!collapsed)}
          className="group/item relative flex h-10 w-full items-center justify-center gap-3 rounded-control px-3 text-sm font-medium text-mute transition-colors hover:bg-raised hover:text-chalk lg:rail-expanded:justify-start"
        >
          {collapsed ? <PanelLeftOpen aria-hidden className="h-5 w-5 shrink-0" /> : <PanelLeftClose aria-hidden className="h-5 w-5 shrink-0" />}
          <span aria-hidden className="hidden lg:rail-expanded:inline">Collapse</span>
          <span
            aria-hidden
            className="pointer-events-none absolute left-full top-1/2 z-40 ml-3 -translate-y-1/2 whitespace-nowrap rounded-control border border-gantry bg-raised px-2.5 py-1 text-xs font-medium text-chalk opacity-0 shadow-lg transition-opacity group-hover/item:opacity-100 group-focus-visible/item:opacity-100 lg:rail-expanded:hidden"
          >
            Expand sidebar
          </span>
        </button>
      </div>
    </aside>
  );
}
