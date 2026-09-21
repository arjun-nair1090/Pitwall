import { cn } from "@/lib/cn";

// Three bars of falling length — a position tower, the one shape every timing screen has in common.
// The leading bar is red, so the mark reads as the leader's row.
export function Mark({ className }: { className?: string }) {
  return (
    <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden className={cn("shrink-0", className)}>
      <g transform="skewX(-14)" transform-origin="0 20">
        <rect x="3" y="2" width="21" height="4" fill="rgb(var(--f1-red))" />
        <rect x="3" y="8" width="14" height="4" fill="currentColor" />
        <rect x="3" y="14" width="7" height="4" fill="currentColor" />
      </g>
    </svg>
  );
}

export default function Wordmark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("font-display font-black uppercase leading-none tracking-[-0.02em]", className)}>
      Pit Wall
    </span>
  );
}
