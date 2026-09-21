"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Radio } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import CompoundBadge from "@/components/CompoundBadge";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fieldBests, mergeBests, type BestKey, type Bests } from "@/lib/sessionBests";
import { classifyTime, formatGap, formatLapTime, formatSector, TIMING_TEXT_CLASS } from "@/lib/timing";
import { useF1Store } from "@/store/useTelemetryStore";

// Below this panel width the three sector columns are dropped so the essentials stay readable.
const SECTORS_MIN_WIDTH = 640;
const BASE_COLUMNS = "2.25rem 4px minmax(3.25rem,1fr) 5rem 4.5rem 5.25rem";
const TYRE_COLUMN = "3.75rem";
const SECTOR_COLUMNS = "4.25rem 4.25rem 4.25rem";

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export default function LiveTiming() {
  const { leaderboard, drivers, selectedDriverNum, setSelectedDriverNum } = useF1Store();
  const reducedMotion = useReducedMotion() ?? false;
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const showSectors = width >= SECTORS_MIN_WIDTH;

  const driversMap = useMemo(() => new Map(drivers.map((d) => [d.driver_number, d])), [drivers]);

  // Best seen this visit, per driver. The live feed does not include session personal bests, so
  // "personal best" (green) means the driver's fastest value since this page was opened, while
  // "overall best" (purple) is the fastest of those across the field.
  // `samples` counts the timing snapshots seen per driver. On a driver's first snapshot there is
  // nothing to compare against, so only an overall best (purple) is claimed, never green or yellow.
  const bestsRef = useRef(new Map<number, { bests: Bests; samples: number }>());
  const lastBoardRef = useRef<unknown>(null);

  const { rows, overall } = useMemo(() => {
    const list = Object.entries(leaderboard)
      .map(([numStr, timing]) => ({ number: parseInt(numStr), timing, driver: driversMap.get(parseInt(numStr)) }))
      .filter((r) => r.driver)
      .sort((a, b) => (a.timing.position || 99) - (b.timing.position || 99));

    // Count a snapshot once per leaderboard object (memo can run twice per render in StrictMode).
    if (lastBoardRef.current !== leaderboard) {
      lastBoardRef.current = leaderboard;
      for (const { number, timing } of list) {
        const prev = bestsRef.current.get(number) ?? { bests: {}, samples: 0 };
        const seen: Bests = { lap: timing.last_lap_time, s1: timing.s1, s2: timing.s2, s3: timing.s3 };
        bestsRef.current.set(number, { bests: mergeBests(prev.bests, seen), samples: prev.samples + 1 });
      }
    }
    const overallBest = fieldBests(Array.from(bestsRef.current.values()).map((entry) => entry.bests));
    return { rows: list, overall: overallBest };
  }, [leaderboard, driversMap]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="Waiting for timing data"
        description="Positions and gaps appear here once a session is live."
        className="h-full"
      />
    );
  }

  const columns = [BASE_COLUMNS, showSectors ? SECTOR_COLUMNS : null, TYRE_COLUMN].filter(Boolean).join(" ");
  const head = "px-1 py-2 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-mute";

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      <div role="table" aria-label="Live timing tower" className="min-w-max text-sm tabular-nums">
        <div role="rowgroup" className="sticky top-0 z-10 border-b border-gantry bg-raised/60 backdrop-blur">
          <div role="row" className="grid items-center pr-2" style={{ gridTemplateColumns: columns }}>
            <span role="columnheader" className={cn(head, "text-center")}>Pos</span>
            <span role="columnheader" aria-hidden className="w-1" />
            <span role="columnheader" className={head}>Driver</span>
            <span role="columnheader" className={cn(head, "text-right")}>Gap</span>
            <span role="columnheader" className={cn(head, "text-right")}>Interval</span>
            <span role="columnheader" className={cn(head, "text-right")}>Last lap</span>
            {showSectors && (["S1", "S2", "S3"] as const).map((s) => (
              <span key={s} role="columnheader" className={cn(head, "text-right")}>{s}</span>
            ))}
            <span role="columnheader" className={cn(head, "pl-3")}>Tyre</span>
          </div>
        </div>

        <div role="rowgroup">
          {rows.map(({ number, timing, driver }) => {
            const isSelected = selectedDriverNum === number;
            const own = bestsRef.current.get(number) ?? { bests: {}, samples: 0 };
            const cell = (key: BestKey, value: number | undefined, format: (n: number | null | undefined) => string) => {
              const kind = classifyTime(value, own.bests[key], overall[key]);
              const claimed = kind === "off-pace" || kind === "personal-best" ? (own.samples > 1 ? kind : "none") : kind;
              return (
                <span role="cell" className={cn("px-1 text-right", TIMING_TEXT_CLASS[claimed])}>
                  {format(value)}
                </span>
              );
            };
            return (
              <motion.div
                key={number}
                role="row"
                layout={!reducedMotion}
                transition={{ type: "spring", stiffness: 380, damping: 36 }}
                className={cn(
                  "grid h-10 items-center border-b border-gantry/60 pr-2 transition-colors even:bg-raised/20 hover:bg-raised/60",
                  isSelected && "bg-raised even:bg-raised",
                )}
                style={{ gridTemplateColumns: columns }}
              >
                <span role="cell" className="text-center font-display text-xl font-black leading-none text-chalk">
                  {timing.position || "–"}
                </span>
                {/* The team's colour runs the full height of the row, flush to its left edge. */}
                <span role="cell" aria-hidden className="h-full w-1" style={{ backgroundColor: driver!.team_color }} />
                <span role="cell" className="min-w-0 px-1">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedDriverNum(isSelected ? null : number)}
                    className="rounded-control px-1 py-2 font-display font-bold uppercase tracking-[0.06em] text-chalk hover:underline"
                  >
                    {driver!.code}
                  </button>
                </span>
                <span role="cell" className="px-1 text-right text-chalk">
                  {timing.gap_to_leader === 0 ? "Leader" : timing.gap_to_leader ? formatGap(timing.gap_to_leader) : "–"}
                </span>
                <span role="cell" className="px-1 text-right text-mute">
                  {timing.gap_to_next ? formatGap(timing.gap_to_next) : "–"}
                </span>
                {cell("lap", timing.last_lap_time, formatLapTime)}
                {showSectors && cell("s1", timing.s1, formatSector)}
                {showSectors && cell("s2", timing.s2, formatSector)}
                {showSectors && cell("s3", timing.s3, formatSector)}
                <span role="cell" className="pl-3">
                  {timing.compound ? <CompoundBadge compound={timing.compound} age={timing.tyre_age} /> : "–"}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
