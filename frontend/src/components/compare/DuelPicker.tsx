"use client";

import { Activity } from "lucide-react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import type { SessionDriver } from "@/hooks/useRaceData";

// A driver code and an optional lap number for each side. An empty lap means "their fastest".
export interface DuelChoice {
  d1: string;
  l1: string;
  d2: string;
  l2: string;
}

interface DuelPickerProps {
  drivers: readonly SessionDriver[];
  value: DuelChoice;
  onChange: (next: DuelChoice) => void;
  onSubmit: () => void;
  loading: boolean;
  // The choices differ from the comparison currently on screen.
  dirty: boolean;
}

const find = (drivers: readonly SessionDriver[], code: string) => drivers.find((d) => d.code === code);

// The lap a choice resolves to, so "fastest" and that lap's own number count as the same lap.
function effectiveLap(drivers: readonly SessionDriver[], code: string, lap: string): string {
  return lap || String(find(drivers, code)?.fastest_lap ?? "");
}

export function sameLap(drivers: readonly SessionDriver[], value: DuelChoice): boolean {
  return value.d1 === value.d2 && effectiveLap(drivers, value.d1, value.l1) === effectiveLap(drivers, value.d2, value.l2);
}

function DriverFields({
  side, drivers, code, lap, onDriver, onLap,
}: {
  side: 1 | 2;
  drivers: readonly SessionDriver[];
  code: string;
  lap: string;
  onDriver: (code: string) => void;
  onLap: (lap: string) => void;
}) {
  const current = find(drivers, code);
  const lapCount = current?.laps ?? 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2">
      <Select label={`Driver ${side}`} value={code} disabled={drivers.length === 0} onChange={(e) => onDriver(e.target.value)}>
        {drivers.map((d) => <option key={d.code} value={d.code}>{d.code} {d.name}</option>)}
      </Select>
      <Select label={`Driver ${side} lap`} value={lap} disabled={!current} onChange={(e) => onLap(e.target.value)}>
        <option value="">{current?.fastest_lap ? `Fastest lap (lap ${current.fastest_lap})` : "Fastest lap"}</option>
        {Array.from({ length: lapCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Lap {n}</option>)}
      </Select>
    </div>
  );
}

export default function DuelPicker({ drivers, value, onChange, onSubmit, loading, dirty }: DuelPickerProps) {
  const identical = drivers.length > 0 && sameLap(drivers, value);
  const pick = (side: 1 | 2, code: string) => {
    const laps = find(drivers, code)?.laps ?? 0;
    const key = side === 1 ? "l1" : "l2";
    const keep = value[key] && Number(value[key]) <= laps ? value[key] : "";
    onChange({ ...value, [side === 1 ? "d1" : "d2"]: code, [key]: keep });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!identical && drivers.length > 0) onSubmit(); }}
      className="flex flex-col gap-3"
    >
      <div className="grid items-end gap-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
        <DriverFields side={1} drivers={drivers} code={value.d1} lap={value.l1} onDriver={(c) => pick(1, c)} onLap={(l) => onChange({ ...value, l1: l })} />
        <span aria-hidden className="hidden pb-2.5 text-center text-sm font-semibold text-faint xl:block">vs</span>
        <DriverFields side={2} drivers={drivers} code={value.d2} lap={value.l2} onDriver={(c) => pick(2, c)} onLap={(l) => onChange({ ...value, l2: l })} />
        <Button type="submit" variant="primary" loading={loading} disabled={drivers.length === 0 || identical} className="xl:min-w-[11rem]">
          <Activity aria-hidden className="h-4 w-4" />
          {dirty ? "Update comparison" : "Compare"}
        </Button>
      </div>
      {identical && <p className="text-sm text-mute">Choose two different drivers, or two different laps of the same driver.</p>}
    </form>
  );
}
