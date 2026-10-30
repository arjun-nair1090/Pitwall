import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export default function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-gantry", className)} />;
}

// One polite live region per loading area, instead of one per placeholder block. A message gets a
// spinner beside it: a grey block alone looks frozen during the minute-long first loads.
export function Loading({ label = "Loading", message, children }: { label?: string; message?: ReactNode; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {message && (
        <p className="mb-4 flex items-center gap-2 text-sm text-mute">
          <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
          {message}
        </p>
      )}
      {children}
    </div>
  );
}
