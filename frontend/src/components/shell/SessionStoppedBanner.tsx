"use client";

import { Flag, PauseCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useF1Store } from "@/store/useTelemetryStore";

function untilRestart(resumesAt: string, now: number): string {
  const minutes = Math.ceil((new Date(resumesAt).getTime() - now) / 60000);
  if (minutes <= 0) return "due now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// While the live session is stopped: why, and when race control says it restarts, in the viewer's
// own time. It stays up for as long as the stop lasts, unlike the toasts, which time out.
export default function SessionStoppedBanner() {
  const status = useF1Store((s) => s.sessionStatus);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!status?.stopped) return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [status?.stopped]);

  // Toasts sit just below the top bar; publish this banner's height so they drop below it instead
  // of covering it (it wraps to several lines on a phone).
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const observer = new ResizeObserver(() => root.style.setProperty("--stop-banner-h", `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--stop-banner-h");
    };
  }, [status?.stopped]);

  if (!status?.stopped) return null;

  const Icon = status.red_flag ? Flag : PauseCircle;
  const tone = status.red_flag ? "text-live-text" : "text-timing-yellow";
  const restart = status.resumes_at
    ? `Resumes at ${new Date(status.resumes_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} your time, ${untilRestart(status.resumes_at, now)}`
    : "Restart time not announced yet";

  return (
    <div
      ref={ref}
      role="status"
      className={cn(
        "relative flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-kerb py-2.5 pl-5 pr-4 md:pl-7",
        status.red_flag ? "border-live/60" : "border-timing-yellow/60",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", status.red_flag ? "bg-live" : "bg-timing-yellow")} />
      <p className={cn("flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.08em]", tone)}>
        <Icon aria-hidden className="h-4 w-4" />
        {status.red_flag ? "Red flag" : "Session stopped"}
      </p>
      <p className="text-sm font-semibold tabular-nums text-chalk">{restart}</p>
      {status.announcement && (
        <p className="text-xs text-mute">
          Race control: {status.announcement}
          {status.resumes_at && " (track time)"}
        </p>
      )}
    </div>
  );
}
