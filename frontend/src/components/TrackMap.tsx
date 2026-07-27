"use client";

import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";

interface LayoutData {
  x: number[];
  y: number[];
  circuit_name: string;
  location: string;
}

export default function TrackMap() {
  const { activeSession, telemetry, drivers } = useF1Store();
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [loading, setLoading] = useState(false);

  // Load layout data when session is initialized
  useEffect(() => {
    if (!activeSession) return;
    setLoading(true);
    // Fetch layout. We pass gp name and year if available, or get defaults
    axios
      .get(`/api/v1/circuits/${activeSession.session_key}/layout`, {
        params: {
          year: activeSession.year,
          gp: activeSession.country,
        },
      })
      .then((res) => {
        setLayout(res.data);
      })
      .catch((err) => {
        console.error("Failed to load circuit layout", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [activeSession]);

  // Normalize path coordinates
  const bounds = useMemo(() => {
    if (!layout || layout.x.length === 0) return null;
    const xs = layout.x;
    const ys = layout.y;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [layout]);

  const svgPadding = 40;
  const svgWidth = 500;
  const svgHeight = 500;

  // Helper to project telemetry coords to SVG space
  const projectPoint = (x: number, y: number) => {
    if (!bounds) return { x: 0, y: 0 };
    // Fit within width/height keeping aspect ratio
    const scale = Math.min(
      (svgWidth - svgPadding * 2) / bounds.width,
      (svgHeight - svgPadding * 2) / bounds.height
    );
    
    const svgX = svgPadding + (x - bounds.minX) * scale;
    // SVG y coordinates are top-to-bottom, invert y
    const svgY = svgHeight - (svgPadding + (y - bounds.minY) * scale);
    return { x: svgX, y: svgY };
  };

  const pathD = useMemo(() => {
    if (!layout || !bounds) return "";
    return layout.x
      .map((x, i) => {
        const pt = projectPoint(x, layout.y[i]);
        return `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      })
      .join(" ");
  }, [layout, bounds]);

  const driversMap = useMemo(() => {
    return new Map(drivers.map((d) => [d.driver_number, d]));
  }, [drivers]);

  return (
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col items-center justify-center relative border border-white/5 bg-black/40">
      <div className="absolute top-4 left-4 z-10">
        <h2 className="text-sm font-semibold tracking-wider text-f1-blue uppercase">
          Live Track Map
        </h2>
        {layout && (
          <div className="text-xs text-white/50 font-mono-f1 mt-0.5">
            {layout.circuit_name} - {layout.location}
          </div>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse text-xs font-mono-f1 text-white/50">
          LOADING CIRCUIT PATH...
        </div>
      ) : layout ? (
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full max-h-[400px] h-auto"
        >
          {/* Circuit Outline */}
          <path
            d={pathD}
            fill="none"
            stroke="#1f2833"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={pathD}
            fill="none"
            stroke="#66fcf1"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="drop-shadow-[0_0_8px_#66fcf1]"
          />

          {/* Animated Drivers */}
          {Object.entries(telemetry).map(([driverNumStr, pt]) => {
            const num = parseInt(driverNumStr);
            const driver = driversMap.get(num);
            if (!driver || pt.x === 0 && pt.y === 0) return null;
            
            const projected = projectPoint(pt.x, pt.y);
            return (
              <g key={num} className="transition-all duration-300">
                {/* Dot Pulse */}
                <circle
                  cx={projected.x}
                  cy={projected.y}
                  r="12"
                  fill={driver.team_color}
                  className="opacity-35 animate-ping"
                />
                {/* Real Dot */}
                <circle
                  cx={projected.x}
                  cy={projected.y}
                  r="7"
                  fill={driver.team_color}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                {/* Acronym label */}
                <text
                  x={projected.x + 10}
                  y={projected.y + 4}
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="bold"
                  className="font-mono-f1 fill-white pointer-events-none select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                >
                  {driver.code}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="text-xs font-mono-f1 text-white/30">
          WAITING FOR SESSION CONFIGURATION...
        </div>
      )}
    </div>
  );
}
