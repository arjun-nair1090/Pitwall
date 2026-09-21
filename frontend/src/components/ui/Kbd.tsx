import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export default function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("rounded-control border border-edge px-1.5 py-0.5 text-[11px] font-medium leading-none text-mute", className)}>
      {children}
    </kbd>
  );
}
