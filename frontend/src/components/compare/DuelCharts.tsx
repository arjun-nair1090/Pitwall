"use client";

import { useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import type { DuelRow, DuelStyle } from "@/lib/duel";
import ChannelChart, { CHART_DEFS } from "./ChannelChart";

interface DuelChartsProps {
  rows: readonly DuelRow[];
  code1: string;
  code2: string;
  style: DuelStyle;
}

function LineKey({ code, color, dash }: { code: string; color: string; dash?: string }) {
  return (
    <li className="flex items-center gap-2 text-sm text-chalk">
      <svg width="28" height="8" aria-hidden><line x1="0" y1="4" x2="28" y2="4" stroke={color} strokeWidth="3" strokeDasharray={dash} strokeLinecap="round" /></svg>
      {code}
    </li>
  );
}

// The lap's telemetry channel by channel, both drivers overlaid. The five that explain most of a
// lap-time difference are on to start; the rest are a click away.
export default function DuelCharts({ rows, code1, code2, style }: DuelChartsProps) {
  const [shown, setShown] = useState<Set<string>>(() => new Set(CHART_DEFS.filter((d) => d.defaultOn).map((d) => d.id)));

  if (rows.length === 0) {
    return <EmptyState title="No telemetry to chart" description="These laps didn't record enough telemetry to plot." />;
  }

  const toggle = (id: string) =>
    setShown((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (next.size === 1) return current; // always keep at least one chart on screen
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const visible = CHART_DEFS.filter((d) => shown.has(d.id));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul role="list" aria-label="Line key" className="flex flex-wrap gap-x-6 gap-y-1">
          <LineKey code={code1} color={style.color1} />
          <LineKey code={code2} color={style.color2} dash={style.dash2} />
        </ul>
        <div role="group" aria-label="Channels" className="flex flex-wrap gap-1.5">
          {CHART_DEFS.map((def) => {
            const on = shown.has(def.id);
            return (
              <button
                key={def.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(def.id)}
                className={cn(
                  "h-8 rounded-control border px-3 text-xs font-medium transition-colors",
                  on ? "border-chalk bg-raised text-chalk" : "border-edge text-mute hover:bg-raised hover:text-chalk",
                )}
              >
                {def.label}
              </button>
            );
          })}
        </div>
      </div>
      {visible.map((def, i) => (
        <ChannelChart key={def.id} def={def} rows={rows} code1={code1} code2={code2} style={style} showDistance={i === visible.length - 1} />
      ))}
    </div>
  );
}
