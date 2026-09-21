"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { findModuleForPath, GROUP_ORDER, MODULES } from "@/lib/modules";

export default function Rail() {
  const current = findModuleForPath(usePathname());
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 overflow-hidden border-r border-gantry bg-tarmac transition-[width] duration-150 hover:w-56 focus-within:w-56 md:block">
      <nav aria-label="Main" className="flex h-full flex-col px-2 py-3">
        <Link href="/" aria-label="Pit Wall home" className="mb-3 flex h-10 items-center gap-3 rounded-control px-2.5 hover:bg-raised">
          <span aria-hidden className="h-5 w-1.5 shrink-0 rounded-sm bg-live" />
          <span className="whitespace-nowrap font-display text-xl font-extrabold text-chalk">Pit Wall</span>
        </Link>
        {GROUP_ORDER.map((group, index) => (
          <div
            key={group}
            role="group"
            aria-label={group}
            className={cn("flex flex-col gap-1", index > 0 && "mt-2 border-t border-gantry pt-2")}
          >
            {MODULES.filter((m) => m.group === group).map((m) => {
              const active = current?.id === m.id;
              const Icon = m.icon;
              return (
                <Link
                  key={m.id}
                  href={m.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 whitespace-nowrap rounded-control px-2.5 text-sm font-medium transition-colors",
                    active ? "bg-raised text-chalk shadow-[inset_2px_0_0_rgb(var(--chalk))]" : "text-mute hover:bg-raised hover:text-chalk",
                  )}
                >
                  <Icon aria-hidden className="h-5 w-5 shrink-0" />
                  <span>{m.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
