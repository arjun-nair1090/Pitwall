"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import { X, PlayCircle, Loader2 } from "lucide-react";
import TelemetryPlayer from "./TelemetryPlayer";

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
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col items-center justify-center relative border border-white/5 bg-black/60 overflow-hidden shadow-[inset_0_0_80px_rgba(0,0,0,0.8)]">
      
      {/* Background ambient glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-f1-blue/10 via-transparent to-f1-cyan/5 pointer-events-none" />

      {/* Header */}
      <div className="absolute top-4 left-4 z-20">
        <h2 className="text-sm font-semibold tracking-wider text-f1-cyan uppercase flex items-center gap-2">
          {isReplayMode ? (
            <><PlayCircle className="h-4 w-4 animate-pulse text-f1-red" /> REPLAY MODE</>
          ) : (
            "LIVE TRACK MAP"
          )}
        </h2>
        {layout && (
          <div className="text-[10px] text-white/50 font-mono-f1 mt-0.5">
            {targetYear} {layout.circuit_name} - {layout.location}
          </div>
        )}
      </div>

      {/* Replay Controls / Status */}
      {isReplayMode && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
          {loadingReplay && <Loader2 className="h-4 w-4 animate-spin text-f1-cyan" />}
          <button 
            onClick={() => setReplaySession(null)}
            className="bg-white/10 hover:bg-f1-red/20 border border-white/20 hover:border-f1-red/50 text-white/70 hover:text-f1-red px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-all"
          >
            <X className="h-3 w-3" /> EXIT REPLAY
          </button>
        </div>
      )}

      {loadingLayout ? (
        <div className="animate-pulse text-xs font-mono-f1 text-white/50 flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          GENERATING CIRCUIT TOPOLOGY...
        </div>
      ) : replayError ? (
        <div className="text-xs font-mono-f1 text-f1-red/70">{replayError}</div>
      ) : layout ? (
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full max-h-[400px] h-auto drop-shadow-2xl z-10"
        >
          <defs>
            <filter id="crispShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* Circuit Outline Base (Asphalt) */}
          <path
            d={pathD}
            fill="none"
            stroke="#2d3748"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#crispShadow)"
          />
          {/* Circuit Outline Centerline */}
          <path
            d={pathD}
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 6"
            className="opacity-70"
          />

          {/* Render Drivers (Replay vs Live) */}
          {isReplayMode && replayData ? (
            // --- REPLAY RENDER ---
            replayData.map((driver) => {
              // Get current pos, fallback to last known if frame exceeds array
              const pt = driver.coords[Math.min(replayPlayback.frame, driver.coords.length - 1)];
              if (!pt) return null;
              const projected = projectPoint(pt.x, pt.y);
              return (
                <g key={driver.code} className="transition-all duration-75">
                  <circle cx={projected.x} cy={projected.y} r="8" fill={driver.color} stroke="#fff" strokeWidth="2" filter="url(#crispShadow)" />
                  {/* Driver background pill */}
                  <rect
                    x={projected.x + 12}
                    y={projected.y - 8}
                    width="26"
                    height="16"
                    rx="4"
                    fill={driver.color}
                    className="opacity-95"
                  />
                  <text
                    x={projected.x + 25}
                    y={projected.y + 3}
                    fontSize="10"
                    fontWeight="900"
                    textAnchor="middle"
                    className="font-mono-f1 fill-white pointer-events-none"
                  >
                    {driver.code}
                  </text>
                </g>
              );
            })
          ) : (
            // --- LIVE RENDER ---
            Object.entries(telemetry).map(([driverNumStr, pt]) => {
              const num = parseInt(driverNumStr);
              const driver = driversMap.get(num);
              if (!driver || (pt.x === 0 && pt.y === 0)) return null;
              
              const projected = projectPoint(pt.x, pt.y);
              return (
                <g 
                  key={num} 
                  className={`transition-all duration-300 cursor-pointer ${selectedDriverNum === num ? 'drop-shadow-[0_0_15px_rgba(255,255,255,0.8)]' : ''}`}
                  onClick={() => setSelectedDriverNum(num)}
                >
                  {/* Dot Pulse Glow */}
                  <circle
                    cx={projected.x}
                    cy={projected.y}
                    r={selectedDriverNum === num ? "25" : "15"}
                    fill={driver.team_color}
                    className="opacity-30 animate-pulse"
                    filter="url(#crispShadow)"
                  />
                  {/* Real Dot */}
                  <circle
                    cx={projected.x}
                    cy={projected.y}
                    r={selectedDriverNum === num ? "10" : "7"}
                    fill={driver.team_color}
                    stroke="#ffffff"
                    strokeWidth="2"
                    filter="url(#crispShadow)"
                  />
                  {/* Driver background pill */}
                  <rect
                    x={projected.x + 12}
                    y={projected.y - 8}
                    width="26"
                    height="16"
                    rx="4"
                    fill={driver.team_color}
                    className="opacity-90"
                  />
                  {/* Acronym label */}
                  <text
                    x={projected.x + 25}
                    y={projected.y + 3}
                    fontSize="10"
                    fontWeight="900"
                    textAnchor="middle"
                    className="font-mono-f1 fill-white pointer-events-none"
                  >
                    {driver.code}
                  </text>
                </g>
              );
            })
          )}
        </svg>
      ) : (
        <div className="text-xs font-mono-f1 text-white/30 text-center px-8">
          NO MAP DATA AVAILABLE FOR THIS SESSION
        </div>
      )}

      {/* Replay Player Overlay at bottom */}
      {isReplayMode && replayData && (
        <div className="absolute bottom-0 left-0 right-0 z-30">
          <TelemetryPlayer />
        </div>
      )}
    </div>
  );
}
