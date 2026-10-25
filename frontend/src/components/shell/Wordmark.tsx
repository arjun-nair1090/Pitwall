import { cn } from "@/lib/cn";
import { LOCKUP_PIT, LOCKUP_SLASH, LOCKUP_VIEWBOX, LOCKUP_WALL, MARK_P, MARK_SLASH, MARK_VIEWBOX } from "./brandPaths";

// The letters take the text colour; the slash is always F1 red. Size either by height (h-*), the width follows.

// "P /": the collapsed sidebar's mark, and the browser tab's.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} aria-hidden className={cn("h-6 w-auto shrink-0", className)}>
      <path d={MARK_P} fill="currentColor" />
      <polygon points={MARK_SLASH} fill="rgb(var(--f1-red))" />
    </svg>
  );
}

// "PIT / WALL": the slash is the wall between the pit lane and the track.
export default function Wordmark({ className }: { className?: string }) {
  return (
    <svg viewBox={LOCKUP_VIEWBOX} aria-hidden className={cn("h-5 w-auto shrink-0", className)}>
      <path d={LOCKUP_PIT} fill="currentColor" />
      <polygon points={LOCKUP_SLASH} fill="rgb(var(--f1-red))" />
      <path d={LOCKUP_WALL} fill="currentColor" />
    </svg>
  );
}
