import { cn } from "@/lib/cn";

// Three bars of falling length — a position tower, the one shape every timing screen has in common.
// The leading bar is red, so the mark reads as the leader's row.
export function Mark({ className }: { className?: string }) {
  return (
    // The lean is baked into the points rather than applied as a transform, so the mark needs no
    // transform attributes and scales cleanly at any size.
    <svg width="25" height="20" viewBox="0 0 25 20" aria-hidden className={cn("shrink-0", className)}>
      <polygon points="3.99,2 24.99,2 23.99,6 2.99,6" fill="rgb(var(--f1-red))" />
      <polygon points="2.49,8 16.49,8 15.49,12 1.49,12" fill="currentColor" />
      <polygon points="1,14 8,14 7,18 0,18" fill="currentColor" />
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
