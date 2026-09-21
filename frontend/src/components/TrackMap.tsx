"use client";

import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import { Loader2, Map as MapIcon } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { readableTextColor } from "@/lib/color";
import { makeProjector } from "@/lib/trackProjection";

interface MarkerProps {
  x: number;
  y: number;
  code: string;
  color: string;
  selected?: boolean;
  onSelect?: () => void;
}

// One car on the circuit: a team-coloured dot plus a code pill whose text is chosen by contrast.
// Live markers are buttons (mouse, touch and keyboard); replay markers are display-only.
function DriverMarker({ x, y, code, color, selected = false, onSelect }: MarkerProps) {
  const interactive = onSelect !== undefined;
  const text = readableTextColor(color);
  return (
    <g
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Select ${code}` : undefined}
      aria-pressed={interactive ? selected : undefined}
      className={interactive ? "cursor-pointer" : undefined}
      onClick={onSelect}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
    >
      {/* Invisible enlarged hit area: the visible dot scales down to a few px on phones */}
      <circle cx={x} cy={y} r="24" fill="transparent" />
      <circle cx={x} cy={y} r={selected ? 11 : 7} fill={color} className="stroke-chalk" strokeWidth="2" />
      <rect x={x + 12} y={y - 8} width="28" height="16" rx="3" fill={color} />
      <text x={x + 26} y={y + 4} fontSize="10" fontWeight="700" textAnchor="middle" fill={text} className="pointer-events-none">
        {code}
      </text>
    </g>
  );
}

interface LayoutData {
  x: number[];
  y: number[];
  circuit_name: string;
  location: string;
}

// The live circuit map: every car in the running session, drawn on the circuit outline. Past races
// are watched in the Replay view instead.
export default function TrackMap() {
  const { activeSession, telemetry, drivers, selectedDriverNum, setSelectedDriverNum } = useF1Store();
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [loadingLayout, setLoadingLayout] = useState(false);

  const year = activeSession?.year;
  const gp = activeSession?.location || activeSession?.country;

  useEffect(() => {
    if (!year || !gp) return;
    let subscribed = true;
    setLoadingLayout(true);
    axios
      .get(`/api/v1/circuits/${activeSession?.session_key || 0}/layout`, { params: { year, gp } })
      .then((res) => { if (subscribed) setLayout(res.data); })
      .catch((err) => console.error("Failed to load circuit layout", err))
      .finally(() => { if (subscribed) setLoadingLayout(false); });
    return () => { subscribed = false; };
  }, [year, gp, activeSession?.session_key]);

  const project = useMemo(
    () => makeProjector(layout ? layout.x.map((x, i) => ({ x, y: layout.y[i] })) : [], 500, 50),
    [layout],
  );
  const pathD = useMemo(
    () => (layout ? layout.x.map((x, i) => { const p = project({ x, y: layout.y[i] }); return `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(" ") : ""),
    [layout, project],
  );
  const driversMap = useMemo(() => new Map(drivers.map((d) => [d.driver_number, d])), [drivers]);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden p-4 pt-14 md:pt-4">
      {layout && (
        <p className="absolute left-3 top-3 z-20 text-xs text-mute">{year} {layout.circuit_name}, {layout.location}</p>
      )}

      {loadingLayout ? (
        <p role="status" className="flex items-center gap-2 text-sm text-mute">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Building the circuit outline…
        </p>
      ) : layout ? (
        <svg viewBox="0 0 500 500" className="z-10 h-full w-full" role="group" aria-label="Circuit map">
          <path d={pathD} fill="none" className="stroke-gantry" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
          <path d={pathD} fill="none" className="stroke-edge" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 6" />
          {Object.entries(telemetry).map(([driverNumStr, pt]) => {
            const num = parseInt(driverNumStr);
            const driver = driversMap.get(num);
            if (!driver || (pt.x === 0 && pt.y === 0)) return null;
            const p = project({ x: pt.x, y: pt.y });
            return (
              <DriverMarker key={num} x={p.x} y={p.y} code={driver.code} color={driver.team_color} selected={selectedDriverNum === num} onSelect={() => setSelectedDriverNum(num)} />
            );
          })}
        </svg>
      ) : (
        <EmptyState
          icon={MapIcon}
          title="No live session right now"
          description="Cars appear here while a session is running. To watch a past race, use the Replay view."
        />
      )}
    </div>
  );
}
