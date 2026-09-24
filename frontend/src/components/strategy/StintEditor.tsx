"use client";

import { useState, type KeyboardEvent } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import CompoundBadge from "@/components/CompoundBadge";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import type { CompoundKey } from "@/lib/compounds";
import {
  addStint, fillRemaining, lapRanges, presetPlan, remainingLaps, removeStint, setStintCompound, setStintLaps, type Stint,
} from "@/lib/strategy";

const TYRES: readonly CompoundKey[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface StintEditorProps {
  stints: readonly Stint[];
  raceLaps: number | null;
  onChange: (next: Stint[]) => void;
}

function TyrePicker({ index, value, disabled, onPick }: { index: number; value: CompoundKey; disabled: boolean; onPick: (c: CompoundKey) => void }) {
  // Arrow keys move through the tyres like a radio group.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    onPick(TYRES[(TYRES.indexOf(value) + step + TYRES.length) % TYRES.length]);
  };
  return (
    <div role="radiogroup" aria-label={`Stint ${index + 1} tyre`} onKeyDown={onKeyDown} className="flex flex-wrap gap-1.5">
      {TYRES.map((compound) => {
        const checked = compound === value;
        return (
          <button
            key={compound}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onPick(compound)}
            className={cn(
              "flex h-9 items-center rounded-control border px-2.5 transition-colors disabled:opacity-50",
              checked ? "border-chalk bg-raised" : "border-edge hover:bg-raised",
            )}
          >
            <CompoundBadge compound={compound} showLabel />
          </button>
        );
      })}
    </div>
  );
}

// A number box that lets you clear it and retype: it only commits once what's typed is a valid
// lap count, and snaps back to the real value when you leave it.
function LapsInput({ label, value, max, disabled, onCommit }: { label: string; value: number; max: number; disabled: boolean; onCommit: (laps: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={1}
      max={max}
      disabled={disabled}
      value={draft ?? value}
      onChange={(e) => {
        const typed = e.target.value;
        const parsed = Number(typed);
        if (typed !== "" && Number.isFinite(parsed) && parsed >= 1) {
          onCommit(parsed);
          setDraft(null);
        } else {
          setDraft(typed);
        }
      }}
      onBlur={() => setDraft(null)}
      className="h-10 w-16 rounded-control border border-edge bg-raised px-2 text-center text-sm tabular-nums text-chalk disabled:opacity-50"
    />
  );
}

export default function StintEditor({ stints, raceLaps, onChange }: StintEditorProps) {
  const known = raceLaps !== null;
  const free = known ? remainingLaps(stints, raceLaps) : 0;
  const ranges = lapRanges(stints);
  const last = stints.length;
  const canAdd = known && addStint(stints, raceLaps).length > stints.length;
  const lastStint = stints[stints.length - 1];
  const canFix = known && free !== 0 && lastStint.laps + free >= 1;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3">
        {stints.map((stint, i) => {
          const max = stint.laps + Math.max(0, free);
          return (
            <li key={i}>
              <div role="group" aria-label={`Stint ${i + 1}`} className="flex flex-col gap-3 rounded-panel border border-gantry bg-tarmac p-3 md:flex-row md:items-center md:gap-5">
                <div className="flex items-baseline justify-between gap-3 md:w-32 md:flex-col md:items-start md:gap-0.5">
                  <span className="text-sm font-semibold text-chalk">Stint {i + 1}</span>
                  <span className="text-xs tabular-nums text-mute">Laps {ranges[i].start} to {ranges[i].end}</span>
                </div>

                <TyrePicker index={i} value={stint.compound} disabled={!known} onPick={(c) => onChange(setStintCompound(stints, i, c))} />

                <div className="flex flex-1 items-center gap-2 md:justify-end">
                  <IconButton label={`Fewer laps in stint ${i + 1}`} disabled={!known || stint.laps <= 1} onClick={() => onChange(setStintLaps(stints, i, stint.laps - 1, raceLaps!))}>
                    <Minus aria-hidden className="h-4 w-4" />
                  </IconButton>
                  <LapsInput label={`Stint ${i + 1} laps`} value={stint.laps} max={max} disabled={!known} onCommit={(n) => onChange(setStintLaps(stints, i, n, raceLaps!))} />
                  <IconButton label={`More laps in stint ${i + 1}`} disabled={!known || free <= 0} onClick={() => onChange(setStintLaps(stints, i, stint.laps + 1, raceLaps!))}>
                    <Plus aria-hidden className="h-4 w-4" />
                  </IconButton>
                  <input
                    type="range"
                    aria-label={`Stint ${i + 1} laps slider`}
                    min={1}
                    max={Math.max(max, 1)}
                    value={stint.laps}
                    disabled={!known}
                    onChange={(e) => onChange(setStintLaps(stints, i, Number(e.target.value), raceLaps!))}
                    className="h-2 min-w-[6rem] flex-1 cursor-pointer accent-chalk md:max-w-[14rem]"
                  />
                  {stints.length > 1 && (
                    <IconButton label={`Remove stint ${i + 1}`} onClick={() => onChange(removeStint(stints, i))}>
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </IconButton>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!canAdd} onClick={() => onChange(addStint(stints, raceLaps!))}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Add stint
        </Button>
        {canFix && (
          <Button variant="ghost" size="sm" onClick={() => onChange(fillRemaining(stints, raceLaps!))}>
            {free > 0
              ? `Use the ${plural(free, "unplanned lap")} on stint ${last}`
              : `Trim stint ${last} by ${plural(-free, "lap")}`}
          </Button>
        )}
        <div role="group" aria-label="Quick plans" className="ml-auto flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-mute">Quick plans</span>
          {[0, 1, 2, 3].map((stops) => (
            <Button key={stops} variant="ghost" size="sm" disabled={!known} onClick={() => onChange(presetPlan(stops, raceLaps!))}>
              {stops === 0 ? "No stop" : `${stops} stop${stops === 1 ? "" : "s"}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
