"use client";

import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";

interface DominanceSegment {
  minisector: number;
  x: number;
  y: number;
  dominant_driver: string;
  color: string;
  speed_delta: number;
}

interface DominanceData {
  driver1: { code: string; color: string };
  driver2: { code: string; color: string };
  dominance: DominanceSegment[];
}

interface TelemetryPoint {
  x: number;
  y: number;
  time: number;
}

interface DominanceMapProps {
  year: number;
  gp: string;
  session: string;
  driver1: string;
  driver2: string;
  telemetry1?: TelemetryPoint[];
  telemetry2?: TelemetryPoint[];
}

export default function DominanceMap({ year, gp, session, driver1, driver2, telemetry1, telemetry2 }: DominanceMapProps) {
  const [data, setData] = useState<DominanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const requestRef = React.useRef<number>();

  useEffect(() => {
    if (!driver1 || !driver2 || !year || !gp) return;

    setLoading(true);
    setError(null);
    axios
      .post("/api/v1/telemetry/dominance", {
        year,
        gp,
        session,
        driver1,
        driver2,
      })
      .then((res) => {
        setData(res.data);
      })
      .catch((err) => {
        console.error(err);
        setError(err.response?.data?.detail || "Failed to load dominance map.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [year, gp, session, driver1, driver2]);

  // Ghost Car Animation Loop
  useEffect(() => {
    if (!isPlaying || !telemetry1 || !telemetry2) {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      return;
    }

    const maxFrames = Math.max(telemetry1.length, telemetry2.length);
    let lastTime = performance.now();
    
    const animate = (time: number) => {
      if (time - lastTime > 33) { // ~30fps
        setFrame(prev => {
          if (prev >= maxFrames - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
        lastTime = time;
      }
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, telemetry1, telemetry2]);

  const bounds = useMemo(() => {
    if (!data || data.dominance.length === 0) return null;
    const xs = data.dominance.map((d) => d.x);
    const ys = data.dominance.map((d) => d.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }, [data]);

  const svgPadding = 50;
  const svgWidth = 500;
  const svgHeight = 500;

  const projectPoint = (x: number, y: number) => {
    if (!bounds) return { x: 0, y: 0 };
    const scale = Math.min(
      (svgWidth - svgPadding * 2) / bounds.width,
      (svgHeight - svgPadding * 2) / bounds.height
    );
    const svgX = svgPadding + (x - bounds.minX) * scale;
    const svgY = svgHeight - (svgPadding + (y - bounds.minY) * scale);
    return { x: svgX, y: svgY };
  };

  return (
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col items-center justify-center relative border border-white/5 bg-black/60 overflow-hidden shadow-[inset_0_0_80px_rgba(0,0,0,0.8)]">
      {/* Background ambient glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-f1-blue/10 via-transparent to-f1-cyan/5 pointer-events-none" />

      {/* Header */}
      <div className="absolute top-4 left-4 z-20">
        <h2 className="text-sm font-semibold tracking-wider text-f1-cyan uppercase flex items-center gap-2">
          DOMINANCE MAP
        </h2>
        {data && (
          <div className="text-[10px] text-white/50 font-mono-f1 mt-0.5">
            {driver1} vs {driver2} • SECTOR SPEED
          </div>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse text-xs font-mono-f1 text-white/50 flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          CALCULATING MINI-SECTORS...
        </div>
      ) : error ? (
        <div className="text-xs font-mono-f1 text-f1-red/70">{error}</div>
      ) : data && bounds ? (
        <>
          {/* Legend */}
          <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: data.driver1.color }} />
              <span className="text-xs font-mono-f1 text-white/80">{data.driver1.code} Faster</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: data.driver2.color }} />
              <span className="text-xs font-mono-f1 text-white/80">{data.driver2.code} Faster</span>
            </div>
            {(telemetry1 && telemetry2) && (
              <button 
                onClick={() => {
                  if (frame >= Math.max(telemetry1.length, telemetry2.length) - 1) setFrame(0);
                  setIsPlaying(!isPlaying);
                }}
                className="mt-2 bg-f1-cyan/20 hover:bg-f1-cyan/40 border border-f1-cyan/50 text-f1-cyan px-3 py-1.5 rounded-md text-[10px] font-bold font-mono-f1 flex items-center justify-center transition-all"
              >
                {isPlaying ? "PAUSE GHOST CARS" : "PLAY GHOST CARS"}
              </button>
            )}
          </div>

          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full max-h-[400px] h-auto drop-shadow-2xl z-10"
          >
            <defs>
              <filter id="crispShadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.4" />
              </filter>
            </defs>

            {/* Render Segments */}
            {data.dominance.map((seg, i) => {
              if (i === data.dominance.length - 1) return null;
              const nextSeg = data.dominance[i + 1];
              
              const pt1 = projectPoint(seg.x, seg.y);
              const pt2 = projectPoint(nextSeg.x, nextSeg.y);
              
              return (
                <line
                  key={i}
                  x1={pt1.x}
                  y1={pt1.y}
                  x2={pt2.x}
                  y2={pt2.y}
                  stroke={seg.color}
                  strokeWidth={6 + Math.min(seg.speed_delta / 5, 8)} 
                  strokeLinecap="round"
                  filter="url(#crispShadow)"
                  className="transition-all duration-300"
                />
              );
            })}

            {/* Ghost Cars */}
            {telemetry1 && telemetry1[frame] && (
              <circle 
                cx={projectPoint(telemetry1[frame].x, telemetry1[frame].y).x}
                cy={projectPoint(telemetry1[frame].x, telemetry1[frame].y).y}
                r="6"
                fill={data.driver1.color}
                stroke="#fff"
                strokeWidth="1.5"
                filter="url(#crispShadow)"
              />
            )}
            {telemetry2 && telemetry2[frame] && (
              <circle 
                cx={projectPoint(telemetry2[frame].x, telemetry2[frame].y).x}
                cy={projectPoint(telemetry2[frame].x, telemetry2[frame].y).y}
                r="6"
                fill={data.driver2.color}
                stroke="#fff"
                strokeWidth="1.5"
                filter="url(#crispShadow)"
              />
            )}
          </svg>
        </>
      ) : (
        <div className="text-xs font-mono-f1 text-white/30 text-center px-8">
          SELECT TWO DRIVERS TO GENERATE DOMINANCE MAP
        </div>
      )}
    </div>
  );
}
