"use client";

import { Gauge } from "lucide-react";
import React, { useMemo } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { useF1Store } from "@/store/useTelemetryStore";

const DRS_OPEN = new Set([1, 12, 14]);

function Bar({ label, value, fill }: { label: string; value: number; fill: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-mute">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-control bg-raised">
        <div className={cn("h-full transition-all duration-100", fill)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export default function TelemetryConsole() {
  const { telemetry, selectedDriverNum, drivers } = useF1Store();

  const driver = useMemo(() => {
    if (selectedDriverNum === null) return null;
    return drivers.find((d) => d.driver_number === selectedDriverNum);
  }, [selectedDriverNum, drivers]);

  const liveTel = useMemo(() => {
    if (selectedDriverNum === null) return null;
    return telemetry[selectedDriverNum] || null;
  }, [selectedDriverNum, telemetry]);

  if (!driver) {
    return (
      <EmptyState
        icon={Gauge}
        title="Select a driver"
        description="Pick a driver in the race tower to see live speed, gear, RPM and pedals."
        className="h-full"
      />
    );
  }

  // Zero until the first telemetry packet for this driver arrives.
  const speed = liveTel?.speed ?? 0;
  const rpm = liveTel?.rpm ?? 0;
  const gear = liveTel?.gear ?? 0;
  const throttle = liveTel?.throttle ?? 0;
  const brake = liveTel?.brake ?? 0;
  const drsOpen = DRS_OPEN.has(liveTel?.drs ?? 0);
  const rpmPercentage = Math.min(100, (rpm / 15000) * 100);

  return (
    <div className="flex h-full flex-col justify-between gap-4 overflow-auto p-4">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-5 w-1 rounded-sm" style={{ backgroundColor: driver.team_color }} />
          <p className="min-w-0 truncate text-sm">
            <span className="font-semibold text-chalk">{driver.full_name}</span>{" "}
            <span className="text-mute">{driver.team_name}</span>
          </p>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs text-mute">
            <span className="tabular-nums">{rpm.toLocaleString()} rpm</span>
            <span>Limit 15,000</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-control bg-raised">
            <div
              className={cn("h-full transition-all duration-100", rpm > 12000 ? "bg-live" : "bg-chalk")}
              style={{ width: `${rpmPercentage}%` }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-4">
          <div>
            <dt className="text-xs text-mute">Gear</dt>
            <dd className="font-display text-5xl font-black leading-none text-chalk">{gear === 0 ? "N" : gear}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Speed</dt>
            <dd className="text-4xl font-bold leading-none tabular-nums text-chalk">
              {Math.round(speed)} <span className="text-sm font-medium text-mute">km/h</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-mute">DRS</dt>
            <dd>
              <span
                className={cn(
                  "inline-block rounded-control border px-2 py-1 text-sm font-semibold",
                  drsOpen ? "border-chalk bg-chalk text-tarmac" : "border-edge text-mute",
                )}
              >
                {drsOpen ? "Open" : "Closed"}
              </span>
            </dd>
          </div>
        </dl>

        <div className="space-y-3">
          <Bar label="Throttle" value={throttle} fill="bg-chalk" />
          <Bar label="Brake" value={brake} fill="bg-live" />
        </div>
      </div>

      <p className="border-t border-gantry pt-2 text-xs text-faint">
        {liveTel ? `Last packet ${new Date(liveTel.timestamp).toLocaleTimeString()}` : "Waiting for the first packet"}
      </p>
    </div>
  );
}
