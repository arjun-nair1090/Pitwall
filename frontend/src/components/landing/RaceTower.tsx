"use client";

import { motion } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  finishOrder, gridOrder, positionsGained, resultLabel, type ClassificationRow,
} from "@/lib/latestResult";
import { teamColor } from "@/lib/timing";

const ROW_HEIGHT = 44;

interface RaceTowerProps {
  rows: readonly ClassificationRow[];
  phase: "grid" | "finish";
  reducedMotion: boolean;
  label: string;
  visibleRows?: number;
}

// The full field is always rendered so cars can visibly overtake into the visible
// window (the rest is clipped), which is the whole point of the reveal.
export default function RaceTower({ rows, phase, reducedMotion, label, visibleRows = 10 }: RaceTowerProps) {
  const ordered = phase === "grid" ? gridOrder(rows) : finishOrder(rows);
  return (
    <ol aria-label={label} className="relative overflow-hidden" style={{ height: visibleRows * ROW_HEIGHT }}>
      {ordered.map((row, index) => {
        const gained = positionsGained(row);
        return (
          <motion.li
            key={row.code}
            layout={!reducedMotion}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="grid items-center border-b border-gantry/60 pr-3 text-sm tabular-nums"
            style={{ height: ROW_HEIGHT, gridTemplateColumns: "2.75rem 4px minmax(0,1fr) auto auto" }}
          >
            <span className="text-center font-display text-2xl font-extrabold leading-none text-chalk">{index + 1}</span>
            <span aria-hidden className="h-6 w-1 rounded-sm" style={{ background: teamColor(row.team) }} />
            <span className="min-w-0 truncate pl-3">
              <span className="font-semibold text-chalk">{row.code}</span>{" "}
              <span className="hidden text-mute sm:inline">{row.name}</span>
            </span>
            <span className={row.finished || phase === "grid" ? "pl-3 text-right text-mute" : "pl-3 text-right text-live-text"}>
              {phase === "finish" ? resultLabel(row) : ""}
            </span>
            <span className="w-12 pl-2 text-right text-xs">
              {phase === "finish" && row.finished && gained !== 0 ? (
                gained > 0 ? (
                  <span className="inline-flex items-center text-timing-green">
                    <ChevronUp aria-hidden className="h-3.5 w-3.5" />+{gained}
                    <span className="sr-only"> {gained === 1 ? "place" : "places"} gained</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center text-mute">
                    <ChevronDown aria-hidden className="h-3.5 w-3.5" />{Math.abs(gained)}
                    <span className="sr-only"> {gained === -1 ? "place" : "places"} lost</span>
                  </span>
                )
              ) : null}
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}
