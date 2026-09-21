"use client";

import CompoundBadge from "@/components/CompoundBadge";
import Panel from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { channelsAt, type ReplayLap } from "@/lib/replay";

interface ReplaySidebarProps {
  lap: ReplayLap;
  seconds: number;
  selected: string | null;
  onSelect: (code: string) => void;
}

const gap = (seconds: number | null, first: boolean) => (first ? "Leader" : seconds === null ? "–" : `+${seconds.toFixed(1)} s`);

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 text-xs text-mute">
      <span className="w-14">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gantry"><span className="block h-full rounded-full bg-chalk" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} /></span>
      <span className="w-8 text-right tabular-nums text-chalk">{Math.round(value)}</span>
    </div>
  );
}

// The order the cars crossed the line at the end of this lap, and a readout for the picked car.
export default function ReplaySidebar({ lap, seconds, selected, onSelect }: ReplaySidebarProps) {
  const driver = lap.drivers.find((d) => d.code === selected) ?? null;
  const now = driver ? channelsAt(driver, seconds, lap.step) : null;

  return (
    <div className="flex flex-col gap-4">
      <Panel title={`Order at the end of lap ${lap.lap}`} meta={`${lap.order.length} cars`}>
        <ol className="divide-y divide-gantry/60">
          {lap.order.map((row, i) => {
            const car = lap.drivers.find((d) => d.code === row.code);
            return (
              <li key={row.code}>
                <button
                  type="button"
                  aria-pressed={row.code === selected}
                  onClick={() => onSelect(row.code)}
                  className={cn("grid w-full grid-cols-[1.75rem_3rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left text-sm tabular-nums transition-colors hover:bg-raised", row.code === selected && "bg-raised")}
                  style={{ boxShadow: `inset 3px 0 0 ${car?.color ?? "#8790A0"}` }}
                >
                  <span className="text-mute">{row.position}</span>
                  <span className="font-semibold text-chalk">{row.code}</span>
                  <span className="text-xs text-mute">{gap(row.gap_to_leader, i === 0)}{row.in_pit ? ", in the pits" : ""}</span>
                  <CompoundBadge compound={row.compound} age={row.tyre_age} />
                </button>
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel title={driver ? driver.name : "Driver readout"} meta={driver?.team}>
        <div className="flex flex-col gap-3 p-4">
          {driver && now ? (
            <>
              <p className="font-display text-4xl font-extrabold leading-none tabular-nums text-chalk">{now.speed}<span className="ml-1 text-sm font-medium text-mute">km/h</span></p>
              <Bar label="Throttle" value={now.throttle} />
              <Bar label="Brake" value={now.brake ? 100 : 0} />
              <p className="text-sm tabular-nums text-mute">
                Gear <span className="text-chalk">{now.gear}</span>, <span className="text-chalk">{now.rpm}</span> rpm, DRS <span className="text-chalk">{now.drs ? "open" : "closed"}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-mute">Pick a car on the map or in the order to see its speed, pedals and gear.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
