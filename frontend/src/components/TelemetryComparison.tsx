"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import { Activity, Zap, Gauge, GitCompare } from "lucide-react";

interface TelemetryPoint {
  distance: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
  code: string;
  lap_time: number | null;
}

interface ComparisonData {
  driver1: TelemetryPoint;
  driver2: TelemetryPoint;
}

interface Channel {
  key: keyof Omit<TelemetryPoint, "distance" | "code" | "lap_time">;
  label: string;
  unit: string;
  min: number;
  max: number;
  height: number;
}

const CHANNELS: Channel[] = [
  { key: "speed",    label: "SPEED",    unit: "km/h", min: 0,    max: 360,  height: 80 },
  { key: "throttle", label: "THROTTLE", unit: "%",    min: 0,    max: 100,  height: 44 },
  { key: "brake",    label: "BRAKE",    unit: "",     min: 0,    max: 1,    height: 30 },
  { key: "rpm",      label: "RPM",      unit: "",     min: 5000, max: 15000,height: 44 },
  { key: "gear",     label: "GEAR",     unit: "",     min: 0,    max: 8,    height: 36 },
  { key: "drs",      label: "DRS",      unit: "",     min: 0,    max: 14,   height: 24 },
];

const PAD = { top: 4, right: 12, bottom: 16, left: 40 };

function formatLapTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "--:--.---";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

export default function TelemetryComparison() {
  const { activeSession, drivers } = useF1Store();
  const [d1, setD1] = useState("VER");
  const [d2, setD2] = useState("NOR");
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const driverCodes = useMemo(() => {
    const codes = drivers.map((d) => d.code).filter(Boolean);
    return codes.length > 0 ? codes : ["VER", "NOR", "HAM", "LEC", "SAI", "RUS", "ALO", "PIA"];
  }, [drivers]);

  const d1Color = useMemo(
    () => drivers.find((d) => d.code === d1)?.team_color || "#66fcf1",
    [drivers, d1]
  );
  const d2Color = useMemo(
    () => drivers.find((d) => d.code === d2)?.team_color || "#ff8000",
    [drivers, d2]
  );

  const fetchComparison = useCallback(() => {
    if (!activeSession) {
      setError("No active session loaded. Session data is required to fetch telemetry.");
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);

    // Use `location` (city name like "Spa-Francorchamps") — FastF1 resolves it correctly.
    // `country` ("Belgium") also works but `location` is more precise for multi-race countries.
    const gp = activeSession.location || activeSession.country;

    axios
      .post("/api/v1/telemetry/compare", {
        year: activeSession.year,
        gp,
        driver1: d1,
        driver2: d2,
      })
      .then((res) => {
        if (res.data.error) {
          setError(res.data.error);
        } else {
          setData(res.data);
        }
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail || err.message || "Unknown error";
        setError(`API error: ${detail}`);
        console.error("Failed to load telemetry comparison:", detail);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [activeSession, d1, d2]);

  // Auto-fetch when session loads
  useEffect(() => {
    if (activeSession) {
      fetchComparison();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);

  // Draw each channel canvas
  useEffect(() => {
    if (!data) return;

    const maxDist = Math.max(
      data.driver1.distance[data.driver1.distance.length - 1] ?? 0,
      data.driver2.distance[data.driver2.distance.length - 1] ?? 0
    );

    CHANNELS.forEach((ch, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const W = rect.width;
      const H = rect.height;
      const cW = W - PAD.left - PAD.right;
      const cH = H - PAD.top - PAD.bottom;

      ctx.fillStyle = "#0a0c10";
      ctx.fillRect(0, 0, W, H);

      // Grid lines
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const y = PAD.top + (cH / 4) * g;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
      }

      const getX = (dist: number) => PAD.left + (dist / maxDist) * cW;
      const getY = (val: number) =>
        PAD.top + (1 - (val - ch.min) / (ch.max - ch.min)) * cH;

      const drawSeries = (tel: TelemetryPoint, color: string, alpha = 1) => {
        const vals = tel[ch.key] as number[];
        if (!vals || vals.length === 0) return;

        // DRS: filled blocks
        if (ch.key === "drs") {
          ctx.fillStyle = color + "99";
          for (let j = 0; j < vals.length; j++) {
            if (vals[j] >= 10) {
              const x1 = getX(tel.distance[j]);
              const x2 = j + 1 < vals.length ? getX(tel.distance[j + 1]) : x1 + 2;
              ctx.fillRect(x1, PAD.top, x2 - x1, cH);
            }
          }
          return;
        }

        // Brake: filled area
        if (ch.key === "brake") {
          ctx.fillStyle = color + "80";
          ctx.beginPath();
          ctx.moveTo(getX(tel.distance[0]), getY(0));
          for (let j = 0; j < vals.length; j++) {
            ctx.lineTo(getX(tel.distance[j]), getY(vals[j] ? ch.max : 0));
          }
          ctx.lineTo(getX(tel.distance[vals.length - 1]), getY(0));
          ctx.closePath();
          ctx.fill();
          return;
        }

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = ch.key === "gear" ? 1.5 : 1.5;
        ctx.beginPath();
        for (let j = 0; j < vals.length; j++) {
          const x = getX(tel.distance[j]);
          const y = getY(Math.max(ch.min, Math.min(ch.max, vals[j])));
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };

      drawSeries(data.driver1, d1Color);
      drawSeries(data.driver2, d2Color);

      // Hover cursor
      if (hoverPct !== null) {
        const hoverX = PAD.left + hoverPct * cW;
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hoverX, PAD.top);
        ctx.lineTo(hoverX, H - PAD.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dots for each driver
        const idx1 = Math.floor(hoverPct * (data.driver1.distance.length - 1));
        const idx2 = Math.floor(hoverPct * (data.driver2.distance.length - 1));
        const v1 = (data.driver1[ch.key] as number[])[idx1];
        const v2 = (data.driver2[ch.key] as number[])[idx2];

        if (ch.key !== "brake" && ch.key !== "drs") {
          ctx.fillStyle = d1Color;
          ctx.beginPath();
          ctx.arc(hoverX, getY(Math.max(ch.min, Math.min(ch.max, v1))), 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = d2Color;
          ctx.beginPath();
          ctx.arc(hoverX, getY(Math.max(ch.min, Math.min(ch.max, v2))), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Y-axis label (min/max)
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = `${8 / dpr + 8}px monospace`;
      ctx.font = "8px monospace";
      ctx.fillText(String(ch.max) + (ch.unit ? ch.unit : ""), 2, PAD.top + 8);
      ctx.fillText(String(ch.min), 2, H - PAD.bottom - 2);
    });
  }, [data, hoverPct, d1Color, d2Color]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!data || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - PAD.left;
      const cW = rect.width - PAD.left - PAD.right;
      if (x >= 0 && x <= cW) {
        setHoverPct(x / cW);
      } else {
        setHoverPct(null);
      }
    },
    [data]
  );

  // Hover tooltip values
  const hoverValues = useMemo(() => {
    if (!data || hoverPct === null) return null;
    const idx1 = Math.floor(hoverPct * (data.driver1.distance.length - 1));
    const idx2 = Math.floor(hoverPct * (data.driver2.distance.length - 1));
    return {
      dist: Math.round(data.driver1.distance[idx1]),
      speed1: Math.round(data.driver1.speed[idx1]),
      speed2: Math.round(data.driver2.speed[idx2]),
      throttle1: Math.round(data.driver1.throttle[idx1]),
      throttle2: Math.round(data.driver2.throttle[idx2]),
      brake1: data.driver1.brake[idx1] ? "ON" : "off",
      brake2: data.driver2.brake[idx2] ? "ON" : "off",
      gear1: data.driver1.gear[idx1],
      gear2: data.driver2.gear[idx2],
      rpm1: Math.round(data.driver1.rpm[idx1]),
      rpm2: Math.round(data.driver2.rpm[idx2]),
      drs1: (data.driver1.drs[idx1] ?? 0) >= 10 ? "OPEN" : "closed",
      drs2: (data.driver2.drs[idx2] ?? 0) >= 10 ? "OPEN" : "closed",
    };
  }, [data, hoverPct]);

  // Lap delta
  const lapDelta = useMemo(() => {
    if (!data) return null;
    const t1 = data.driver1.lap_time;
    const t2 = data.driver2.lap_time;
    if (t1 === null || t2 === null) return null;
    return t1 - t2;
  }, [data]);

  return (
    <div className="glass-panel rounded-lg p-3 h-full flex flex-col border border-white/5 bg-black/30 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 border-b border-white/5 pb-2 flex-shrink-0">
        <h2 className="text-xs font-semibold tracking-wider text-f1-cyan uppercase flex items-center gap-1.5">
          <GitCompare className="h-3.5 w-3.5" />
          Lap Telemetry Comparison
        </h2>
        <div className="flex gap-1.5 text-[10px] items-center">
          <select
            value={d1}
            onChange={(e) => setD1(e.target.value)}
            className="bg-black/60 border border-white/15 text-white px-1.5 py-0.5 rounded font-mono focus:outline-none"
            style={{ color: d1Color }}
          >
            {driverCodes.map((code) => (
              <option key={code} value={code} style={{ color: "white" }}>{code}</option>
            ))}
          </select>
          <span className="text-white/30 font-bold">VS</span>
          <select
            value={d2}
            onChange={(e) => setD2(e.target.value)}
            className="bg-black/60 border border-white/15 text-white px-1.5 py-0.5 rounded font-mono focus:outline-none"
            style={{ color: d2Color }}
          >
            {driverCodes.map((code) => (
              <option key={code} value={code} style={{ color: "white" }}>{code}</option>
            ))}
          </select>
          <button
            onClick={fetchComparison}
            disabled={loading}
            className="bg-f1-cyan hover:bg-f1-cyan/85 disabled:opacity-50 text-black font-bold px-2.5 py-0.5 rounded transition-colors"
          >
            {loading ? "LOADING…" : "COMPARE"}
          </button>
        </div>
      </div>

      {/* Lap time header */}
      {data && (
        <div className="flex gap-4 mb-2 text-[10px] font-mono flex-shrink-0">
          <span style={{ color: d1Color }} className="font-bold">
            {d1} {formatLapTime(data.driver1.lap_time)}
          </span>
          {lapDelta !== null && (
            <span className={lapDelta < 0 ? "text-emerald-400" : "text-red-400"}>
              {lapDelta < 0 ? "▲" : "▼"} {Math.abs(lapDelta).toFixed(3)}s
            </span>
          )}
          <span style={{ color: d2Color }} className="font-bold">
            {d2} {formatLapTime(data.driver2.lap_time)}
          </span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <Activity className="h-6 w-6 text-red-500/60 mx-auto mb-2" />
            <p className="text-[10px] text-red-400 font-mono">{error}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Zap className="h-5 w-5 text-f1-cyan/60 mx-auto mb-2 animate-pulse" />
            <p className="text-[10px] text-white/40 font-mono">LOADING FASTEST LAP TELEMETRY…</p>
            <p className="text-[9px] text-white/20 font-mono mt-1">FastF1 data via cache</p>
          </div>
        </div>
      )}

      {/* No session state */}
      {!activeSession && !loading && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Gauge className="h-6 w-6 text-white/20 mx-auto mb-2" />
            <p className="text-[10px] text-white/30 font-mono">AWAITING SESSION DATA</p>
            <p className="text-[9px] text-white/20 font-mono mt-1">Select a session to compare lap telemetry</p>
          </div>
        </div>
      )}

      {/* Charts */}
      {data && !loading && !error && (
        <div
          ref={containerRef}
          className="flex-1 flex flex-col gap-0.5 min-h-0 overflow-hidden relative"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverPct(null)}
        >
          {CHANNELS.map((ch, i) => (
            <div key={ch.key} className="relative flex-shrink-0" style={{ height: ch.height }}>
              {/* Channel label */}
              <div className="absolute left-0 top-0 bottom-0 w-9 flex items-center">
                <span className="text-[8px] font-mono text-white/30 uppercase leading-tight">
                  {ch.label}
                </span>
              </div>
              <canvas
                ref={(el) => { canvasRefs.current[i] = el; }}
                className="w-full h-full"
                style={{ display: "block" }}
              />
            </div>
          ))}

          {/* Distance axis */}
          <div className="flex-shrink-0 flex justify-between text-[8px] font-mono text-white/20 px-10">
            <span>0m</span>
            {data && (
              <span>{Math.round(data.driver1.distance[data.driver1.distance.length - 1])}m</span>
            )}
          </div>

          {/* Hover tooltip */}
          {hoverValues && (
            <div className="absolute top-1 right-1 bg-black/90 border border-white/10 rounded p-2 text-[9px] font-mono space-y-0.5 z-20 pointer-events-none min-w-[130px]">
              <div className="text-white/40 mb-1">{hoverValues.dist}m</div>
              <div className="grid grid-cols-3 gap-x-2 text-white/60 text-[8px] mb-0.5">
                <span></span>
                <span style={{ color: d1Color }}>{d1}</span>
                <span style={{ color: d2Color }}>{d2}</span>
              </div>
              {[
                ["SPD", `${hoverValues.speed1}`, `${hoverValues.speed2}`],
                ["THR", `${hoverValues.throttle1}%`, `${hoverValues.throttle2}%`],
                ["BRK", hoverValues.brake1, hoverValues.brake2],
                ["GEAR", `${hoverValues.gear1}`, `${hoverValues.gear2}`],
                ["RPM", `${hoverValues.rpm1}`, `${hoverValues.rpm2}`],
                ["DRS", hoverValues.drs1, hoverValues.drs2],
              ].map(([label, v1, v2]) => (
                <div key={label} className="grid grid-cols-3 gap-x-2">
                  <span className="text-white/30">{label}</span>
                  <span style={{ color: d1Color }} className="font-bold">{v1}</span>
                  <span style={{ color: d2Color }} className="font-bold">{v2}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
