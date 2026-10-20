"use client";

import { useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import Select from "@/components/ui/Select";
import type { BattleDriver, Overtake } from "@/lib/battles";

// Every pass in the server's order (lap, then position), optionally narrowed to one driver's
// passes made or suffered.
export default function PassFeed({ overtakes, drivers }: { overtakes: Overtake[]; drivers: BattleDriver[] }) {
  const [code, setCode] = useState("");

  if (overtakes.length === 0) {
    return <EmptyState title="No on-track passes" description="No position changes were recorded outside the pits and neutralised laps." />;
  }

  const shown = code === "" ? overtakes : overtakes.filter((o) => o.driver === code || o.passed === code);

  return (
    <div className="flex flex-col gap-4">
      <Select label="Driver" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-xs">
        <option value="">All drivers</option>
        {drivers.map((d) => <option key={d.code} value={d.code}>{`${d.name} (${d.code})`}</option>)}
      </Select>
      {shown.length === 0 ? (
        <p className="text-sm text-mute">{`No on-track passes involve ${code}.`}</p>
      ) : (
        <ul className="max-h-96 divide-y divide-gantry overflow-y-auto text-sm tabular-nums">
          {shown.map((o, i) => (
            <li key={`${o.lap}-${o.driver}-${o.passed}-${i}`} className="py-1.5">
              {`Lap ${o.lap} · ${o.driver} passed ${o.passed} for P${o.position}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
