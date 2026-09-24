import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export default function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-gantry", className)} />;
}

// One polite live region per loading area, instead of one per placeholder block.
export function Loading({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
