"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import { X, Loader2, Map as MapIcon } from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Pill from "@/components/ui/Pill";
import { readableTextColor } from "@/lib/color";
import TelemetryPlayer from "./TelemetryPlayer";

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

interface ReplayDriver {
  driver_number?: number;
  code: string;
  color: string;
  coords: { x: number; y: number }[];
  telemetry?: {
    speed: number;
    throttle: number;
    brake: number;
    gear: number;
    rpm: number;
    drs: number;
  }[];
}

export default function TrackMap() {
  const { activeSession, telemetry, drivers, replaySession, setReplaySession, selectedDriverNum, setSelectedDriverNum } = useF1Store();
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [loadingLayout, setLoadingLayout] = useState(false);
  
  // Replay State
  const [replayData, setReplayData] = useState<ReplayDriver[] | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const requestRef = useRef<number>();

  // Determine current context (Replay vs Live)
  const isReplayMode = !!replaySession;
  const targetYear = replaySession ? replaySession.year : activeSession?.year;
  const targetGp = replaySession ? replaySession.gp : (activeSession?.location || activeSession?.country);

  // Load layout data when session or replay changes
  useEffect(() => {
    if (!targetYear || !targetGp) return;
    
    let isSubscribed = true;
    setLoadingLayout(true);
    axios
      .get(`/api/v1/circuits/${activeSession?.session_key || 0}/layout`, {
        params: { year: targetYear, gp: targetGp },
      })
      .then((res) => {
        if (isSubscribed) setLayout(res.data);
      })
      .catch((err) => {
        console.error("Failed to load circuit layout", err);
      })
      .finally(() => {
        if (isSubscribed) setLoadingLayout(false);
      });

    return () => { isSubscribed = false; };
  }, [targetYear, targetGp, activeSession?.session_key]);

  // Load replay data if in replay mode
  useEffect(() => {
    if (!isReplayMode) {
      setReplayData(null);
      setReplayError(null);
      return;
    }

    let isSubscribed = true;
    setLoadingReplay(true);
    setReplayError(null);
    axios
      .get(`/api/v1/telemetry/replay`, {
        params: { year: replaySession.year, gp: replaySession.gp, lap_number: replaySession.lap || 1 },
      })
      .then((res) => {
        if (isSubscribed && res.data.drivers) {
          setReplayData(res.data.drivers);
          setReplayPlayback({ currentLap: res.data.current_lap, totalLaps: res.data.total_laps });
          if (res.data.leaderboard) {
            updateLeaderboard(res.data.leaderboard);
          }
        }
      })
      .catch((err) => {
        if (isSubscribed) setReplayError("Replay data unavailable for this session.");
      })
      .finally(() => {
        if (isSubscribed) setLoadingReplay(false);
      });
      
    return () => { isSubscribed = false; };
  }, [replaySession, isReplayMode]);

  // Playback integration with store
  const { replayPlayback, setReplayPlayback, updateTelemetryPoint, updateLeaderboard } = useF1Store();

  useEffect(() => {
    if (!isReplayMode || !replayData || replayData.length === 0) return;

    // Set max frame when data loads
    const maxLen = Math.max(...replayData.map(d => d.coords.length));
    setReplayPlayback({ maxFrame: maxLen, isPlaying: true });
    
    // Create driver map in store for the replay so telemetry console shows names
    const mockDrivers = replayData.map(d => ({
      driver_number: d.driver_number || parseInt(d.code) || d.code.charCodeAt(0),
      code: d.code,
      full_name: d.code,
      team_color: d.color,
      team_name: "Archive"
    }));
    useF1Store.getState().setDrivers(mockDrivers);
    
  }, [isReplayMode, replayData]);

  // Animation Loop for Replay using global state
  useEffect(() => {
    if (!isReplayMode || !replayData || replayData.length === 0 || !replayPlayback.isPlaying) {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      return;
    }

    let lastTime = performance.now();
    const animate = (time: number) => {
      // Throttle animation speed (e.g. 30fps default) adjusted by playback speed
      const delay = 33 / replayPlayback.speed;
      if (time - lastTime > delay) {
        const state = useF1Store.getState();
        const currentFrame = state.replayPlayback.frame;
        const max = state.replayPlayback.maxFrame;
        const currentLap = state.replayPlayback.currentLap;
        const totalLaps = state.replayPlayback.totalLaps;
        const nextFrame = currentFrame + 1;

        if (nextFrame >= max) {
          if (currentLap && totalLaps && currentLap < totalLaps) {
            setReplayPlayback({ frame: 0 });
            setReplaySession({ ...state.replaySession!, lap: currentLap + 1 });
            return;
          } else {
            setReplayPlayback({ frame: max - 1, isPlaying: false });
            return;
          }
        } else {
          setReplayPlayback({ frame: nextFrame });
        }
        
        // Dispatch telemetry points for all drivers at this frame
        const actualFrame = useF1Store.getState().replayPlayback.frame;
        replayData.forEach(d => {
          if (d.telemetry && d.telemetry[actualFrame]) {
            const tel = d.telemetry[actualFrame];
            const driverNum = d.driver_number || parseInt(d.code) || d.code.charCodeAt(0);
            updateTelemetryPoint({
              driver_number: driverNum,
              timestamp: new Date().toISOString(),
              speed: tel.speed,
              throttle: tel.throttle,
              brake: tel.brake,
              gear: tel.gear,
              rpm: tel.rpm,
              drs: tel.drs,
              x: d.coords[actualFrame]?.x || 0,
              y: d.coords[actualFrame]?.y || 0,
              z: 0,
              live_signal: false
            });
          }
        });
        
        lastTime = time;
      }
      requestRef.current = requestAnimationFrame(animate);
    };
    
    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isReplayMode, replayData, replayPlayback.isPlaying, replayPlayback.speed, replayPlayback.maxFrame]);

  // Normalize path coordinates
  const bounds = useMemo(() => {
    if (!layout || layout.x.length === 0) return null;
    const xs = layout.x;
    const ys = layout.y;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }, [layout]);

  const svgPadding = 50;
  const svgWidth = 500;
  const svgHeight = 500;

  // Helper to project telemetry coords to SVG space
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
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden p-4 pt-14 md:pt-4">
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
        {isReplayMode && <Pill>Replay</Pill>}
        {layout && (
          <p className="text-xs text-mute">
            {targetYear} {layout.circuit_name}, {layout.location}
          </p>
        )}
      </div>

      {isReplayMode && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-3">
          {loadingReplay && <Loader2 aria-hidden className="h-4 w-4 animate-spin text-mute" />}
          <Button size="sm" variant="secondary" onClick={() => setReplaySession(null)}>
            <X aria-hidden className="h-3.5 w-3.5" />
            Exit replay
          </Button>
        </div>
      )}

      {loadingLayout ? (
        <p role="status" className="flex items-center gap-2 text-sm text-mute">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Building the circuit outline…
        </p>
      ) : replayError ? (
        <p role="alert" className="max-w-md px-6 text-center text-sm text-live-text">{replayError}</p>
      ) : layout ? (
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="z-10 h-full w-full" role="group" aria-label="Circuit map">
          {/* Circuit outline: asphalt, then the racing-line dashes */}
          <path d={pathD} fill="none" className="stroke-gantry" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d={pathD}
            fill="none"
            className="stroke-edge"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 6"
          />

          {isReplayMode && replayData
            ? replayData.map((driver) => {
                // Current position, falling back to the last known one if the frame exceeds the array
                const pt = driver.coords[Math.min(replayPlayback.frame, driver.coords.length - 1)];
                if (!pt) return null;
                const projected = projectPoint(pt.x, pt.y);
                return <DriverMarker key={driver.code} x={projected.x} y={projected.y} code={driver.code} color={driver.color} />;
              })
            : Object.entries(telemetry).map(([driverNumStr, pt]) => {
                const num = parseInt(driverNumStr);
                const driver = driversMap.get(num);
                if (!driver || (pt.x === 0 && pt.y === 0)) return null;
                const projected = projectPoint(pt.x, pt.y);
                return (
                  <DriverMarker
                    key={num}
                    x={projected.x}
                    y={projected.y}
                    code={driver.code}
                    color={driver.team_color}
                    selected={selectedDriverNum === num}
                    onSelect={() => setSelectedDriverNum(num)}
                  />
                );
              })}
        </svg>
      ) : (
        <EmptyState
          icon={MapIcon}
          title="No map data yet"
          description="The circuit appears when a session is live, or when you load a replay."
        />
      )}

      {/* Replay player overlay at the bottom */}
      {isReplayMode && replayData && (
        <div className="absolute bottom-0 left-0 right-0 z-30">
          <TelemetryPlayer />
        </div>
      )}
    </div>
  );
}
