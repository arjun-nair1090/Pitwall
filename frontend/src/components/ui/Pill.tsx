import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "live" | "purple" | "green" | "yellow";
const TONE: Record<Tone, string> = {
  neutral: "border-edge text-mute",
  live: "border-live/60 text-live-text",
  purple: "border-timing-purple/60 text-timing-purple",
  green: "border-timing-green/60 text-timing-green",
  yellow: "border-timing-yellow/60 text-timing-yellow",
};

// Squared off, not a lozenge: timing graphics are cut with straight edges.
export default function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.08em] tabular-nums",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
