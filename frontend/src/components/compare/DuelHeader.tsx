"use client";

import { Download } from "lucide-react";
import CompoundBadge from "@/components/CompoundBadge";
import type { DuelDriver, DuelStyle } from "@/lib/duel";
import type { SessionCode } from "@/lib/season";
import { formatLapTime } from "@/lib/timing";

export type { DuelDriver } from "@/lib/duel";

interface DuelHeaderProps {
  driver1: DuelDriver;
  driver2: DuelDriver;
  style: DuelStyle;
  year: number;
  eventName: string;
  session: SessionCode;
}

function marginText(a: DuelDriver, b: DuelDriver): string {
  if (a.lap_time === null || b.lap_time === null) return "Lap time unavailable";
  const gap = b.lap_time - a.lap_time;
  if (Math.abs(gap) < 0.0005) return "Identical lap times";
  return `${gap > 0 ? a.code : b.code} was ${Math.abs(gap).toFixed(3)} s faster`;
}

// How a driver's line looks in the charts, so the card doubles as the key.
function LineKey({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="28" height="8" aria-hidden className="shrink-0">
      <line x1="0" y1="4" x2="28" y2="4" stroke={color} strokeWidth="3" strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

function DriverCard({
  driver, color, dash, resultCard,
}: { driver: DuelDriver; color: string; dash?: string; resultCard?: string }) {
  return (
    <section
      aria-label={`${driver.code} lap`}
      className="flex min-w-0 flex-col gap-3 rounded-panel border border-gantry bg-kerb p-4"
      style={{ boxShadow: `inset 4px 0 0 ${color}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <LineKey color={color} dash={dash} />
          <h3 className="font-display text-3xl font-extrabold leading-none text-chalk">{driver.code}</h3>
        </div>
        {resultCard && (
          <a
            href={resultCard}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Result card for ${driver.code}`}
            title={`Open the shareable result card for ${driver.code}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-control text-mute transition-colors hover:bg-raised hover:text-chalk"
          >
            <Download aria-hidden className="h-4 w-4" />
          </a>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-chalk">{driver.name}</p>
        <p className="truncate text-xs text-mute">{driver.team}</p>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs tabular-nums text-mute">Lap {driver.lap_number}</span>
          <CompoundBadge compound={driver.compound} showLabel />
        </div>
        <span className="font-display text-3xl font-extrabold leading-none tabular-nums text-chalk">{formatLapTime(driver.lap_time)}</span>
      </div>
    </section>
  );
}

export default function DuelHeader({ driver1, driver2, style, year, eventName, session }: DuelHeaderProps) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const card = (code: string) =>
    session === "R"
      ? `${apiBase}/api/v1/share/result-card?${new URLSearchParams({ year: String(year), gp: eventName, session: "Race", driver: code })}`
      : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        <DriverCard driver={driver1} color={style.color1} resultCard={card(driver1.code)} />
        <p role="status" className="px-2 text-center text-sm font-semibold text-chalk md:max-w-[9rem]">{marginText(driver1, driver2)}</p>
        <DriverCard driver={driver2} color={style.color2} dash={style.dash2} resultCard={card(driver2.code)} />
      </div>
      {style.sameTeam && (
        <p className="text-xs text-mute">Teammates share a colour, so {driver2.code} is shown lighter and dashed on the charts and the map.</p>
      )}
    </div>
  );
}
