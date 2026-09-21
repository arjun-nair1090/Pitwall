"use client";

import React from "react";
import { Activity, Loader2 } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { useF1Store } from "@/store/useTelemetryStore";

function Meter({ label, value, fill }: { label: string; value: number; fill: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-mute">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value)}%</span>
      </div>
      <div className="h-6 w-full overflow-hidden rounded-control bg-raised">
        <div className={cn("h-full transition-all duration-75", fill)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export default function DriverLiveTelemetry() {
  const { telemetry, drivers, selectedDriverNum } = useF1Store();

  const driver = drivers.find((d) => d.driver_number === selectedDriverNum);
  const data = selectedDriverNum ? telemetry[selectedDriverNum] : null;

  if (!selectedDriverNum || !driver) {
    return (
      <EmptyState
        icon={Activity}
        title="Select a driver"
        description="Choose a car on the map to see its live telemetry."
        className="h-full"
      />
    );
  }

  if (!data) {
    return (
      <p role="status" className="flex h-full items-center justify-center gap-2 p-6 text-sm text-mute">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        Waiting for the telemetry stream…
      </p>
    );
  }

  const speedPercentage = Math.min((data.speed / 350) * 100, 100);
  const drsOpen = data.drs >= 10 && data.drs <= 14;
  const live = data.live_signal !== false;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3 border-b border-gantry pb-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-10 w-1 rounded-sm" style={{ backgroundColor: driver.team_color }} />
          <div>
            <p className="font-semibold text-chalk">{driver.full_name}</p>
            <p className="text-xs text-mute">
              #{driver.driver_number} {driver.team_name}
            </p>
          </div>
        </div>
        <span className="flex items-center gap-2 text-xs text-mute">
          <span aria-hidden className={cn("h-2 w-2 rounded-full", live ? "animate-pulse bg-live" : "border border-faint")} />
          {live ? "Live" : "Offline"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-mute">Speed</dt>
          <dd className="mt-1 text-4xl font-bold leading-none tabular-nums text-chalk">
            {Math.round(data.speed)} <span className="text-sm font-medium text-mute">km/h</span>
          </dd>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-chalk transition-all duration-200" style={{ width: `${speedPercentage}%` }} />
          </div>
        </div>
        <div>
          <dt className="text-xs text-mute">Gear</dt>
          <dd className="mt-1 font-display text-5xl font-extrabold leading-none text-chalk">{data.gear === 0 ? "N" : data.gear}</dd>
        </div>
      </dl>

      <div>
        <div className="mb-1 flex items-end justify-between text-xs text-mute">
          <span>Engine</span>
          <span className="tabular-nums text-sm font-semibold text-chalk">{data.rpm.toLocaleString()} rpm</span>
        </div>
        {/* Shift lights: one segment per 1,000 rpm. The last two are red (near the limiter). */}
        <div className="flex h-3 gap-1" role="img" aria-label={`${data.rpm} rpm of 15,000`}>
          {Array.from({ length: 15 }).map((_, i) => {
            const active = (i + 1) * 1000 <= data.rpm;
            return (
              <div
                key={i}
                className={cn("flex-1 rounded-sm transition-colors duration-75", active ? (i >= 13 ? "bg-live" : "bg-chalk") : "bg-raised")}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <Meter label="Throttle" value={data.throttle} fill="bg-chalk" />
        <Meter label="Brake" value={data.brake} fill="bg-live" />
      </div>

      <div className="flex items-center justify-between rounded-control border border-gantry px-3 py-2">
        <span className="text-xs text-mute">DRS</span>
        <span
          className={cn(
            "rounded-control px-2 py-1 text-xs font-semibold",
            drsOpen ? "bg-chalk text-tarmac" : "border border-edge text-mute",
          )}
        >
          {drsOpen ? "Open" : "Closed"}
        </span>
      </div>
    </div>
  );
}
