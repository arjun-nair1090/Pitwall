"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/cn";
import { findModuleForPath, MODULES } from "@/lib/modules";
import { usePaletteStore } from "@/store/usePaletteStore";

const PRIMARY = MODULES.filter((m) => m.mobilePrimary);

export default function MobileTabBar() {
  const current = findModuleForPath(usePathname());
  const setOpen = usePaletteStore((s) => s.setOpen);
  // White marks the page you're on, the same signal the sidebar and the tab strips use.
  const item =
    "relative flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 border-transparent font-display text-[10px] font-bold uppercase tracking-[0.08em] transition-colors";
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-gantry bg-tarmac pb-[env(safe-area-inset-bottom)] md:hidden">
      {PRIMARY.map((m) => {
        const active = current?.id === m.id;
        const Icon = m.icon;
        return (
          <Link key={m.id} href={m.href} aria-current={active ? "page" : undefined} className={cn(item, active ? "border-chalk text-chalk" : "text-mute")}>
            <Icon aria-hidden className="h-5 w-5" />
            {m.shortLabel}
          </Link>
        );
      })}
      <button type="button" onClick={() => setOpen(true)} aria-label="More pages and search" className={cn(item, "text-mute")}>
        <Menu aria-hidden className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}
