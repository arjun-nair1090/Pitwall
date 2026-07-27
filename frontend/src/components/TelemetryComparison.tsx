"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";

interface TelemetryPoint {
  distance: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
  code: string;
  lap_time: number;
}

interface ComparisonData {
  driver1: TelemetryPoint;
  driver2: TelemetryPoint;
}

export default function TelemetryComparison() {
  const { activeSession, drivers } = useF1Store();
  const [d1, setD1] = useState("VER");
  const [d2, setD2] = useState("NOR");
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const driverCodes = useMemo(() => {
    return drivers.map((d) => d.code).filter(Boolean);
  }, [drivers]);

  // Load compared telemetry
  const fetchComparison = () => {
    if (!activeSession) return;
    setLoading(true);
    axios
      .post("/api/v1/telemetry/compare", {
        year: activeSession.year,
        gp: activeSession.country,
        driver1: d1,
        driver2: d2,
      })
      .then((res) => {
        setData(res.data);
      })
      .catch((err) => {
        console.error("Failed to load compared telemetry", err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (activeSession) {
      fetchComparison();
    }
  }, [activeSession]);

  // Draw charts onto canvas
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set dimensions
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, width, height);

    // Grid details
    const padding = { top: 20, right: 30, bottom: 30, left: 50 };
    const chartHeight = height - padding.top - padding.bottom;
    const chartWidth = width - padding.left - padding.right;

    // Drawing Grid Lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Min/Max values for scaling
    // Speed max ~ 350 km/h, min 0
    const maxSpeed = 350;
    const maxDist = Math.max(
      data.driver1.distance[data.driver1.distance.length - 1],
      data.driver2.distance[data.driver2.distance.length - 1]
    );

    // Helpers to scale points to pixels
    const getX = (dist: number) => padding.left + (dist / maxDist) * chartWidth;
    const getY = (speed: number) => padding.top + (1 - speed / maxSpeed) * chartHeight;

    const drawLine = (tel: TelemetryPoint, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      for (let i = 0; i < tel.distance.length; i++) {
        const x = getX(tel.distance[i]);
        const y = getY(tel.speed[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // Draw driver 1 telemetry in red/cyan
    const d1Color = drivers.find((d) => d.code === d1)?.team_color || "#66fcf1";
    const d2Color = drivers.find((d) => d.code === d2)?.team_color || "#e10600";

    drawLine(data.driver1, d1Color);
    drawLine(data.driver2, d2Color);

    // Labels
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "9px monospace";
    ctx.fillText("350 KM/H", 5, padding.top + 5);
    ctx.fillText("175 KM/H", 5, padding.top + chartHeight / 2 + 3);
    ctx.fillText("0 KM/H", 5, height - padding.bottom);
    ctx.fillText("Distance (m)", width / 2 - 30, height - 10);

    // Draw cursor highlight if hovering
    if (hoverIndex !== null && hoverIndex < data.driver1.distance.length) {
      const dist = data.driver1.distance[hoverIndex];
      const hoverX = getX(dist);

      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hoverX, padding.top);
      ctx.lineTo(hoverX, height - padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]); // reset

      // Draw values at cursor
      const val1 = data.driver1.speed[hoverIndex];
      const val2 = data.driver2.speed[hoverIndex];
      
      ctx.fillStyle = d1Color;
      ctx.beginPath();
      ctx.arc(hoverX, getY(val1), 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = d2Color;
      ctx.beginPath();
      ctx.arc(hoverX, getY(val2), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [data, hoverIndex, d1, d2, drivers]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const paddingLeft = 50;
    const paddingRight = 30;
    const chartWidth = rect.width - paddingLeft - paddingRight;

    // Check if x within graph bounds
    if (x >= paddingLeft && x <= rect.width - paddingRight) {
      const percent = (x - paddingLeft) / chartWidth;
      const index = Math.floor(percent * data.driver1.distance.length);
      setHoverIndex(index);
    } else {
      setHoverIndex(null);
    }
  };

  return (
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col justify-between border border-white/5 bg-black/30">
      <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
        <h2 className="text-sm font-semibold tracking-wider text-f1-cyan uppercase">
          Lap Telemetry Comparison
        </h2>
        {/* Selector Grid */}
        <div className="flex gap-2 text-xs">
          <select
            value={d1}
            onChange={(e) => setD1(e.target.value)}
            className="bg-black/50 border border-white/15 text-white p-1 rounded font-mono-f1 focus:outline-none"
          >
            {driverCodes.length > 0 ? (
              driverCodes.map((code) => <option key={code} value={code}>{code}</option>)
            ) : (
              <>
                <option value="VER">VER</option>
                <option value="HAM">HAM</option>
              </>
            )}
          </select>
          <span className="text-white/40 self-center">VS</span>
          <select
            value={d2}
            onChange={(e) => setD2(e.target.value)}
            className="bg-black/50 border border-white/15 text-white p-1 rounded font-mono-f1 focus:outline-none"
          >
            {driverCodes.length > 0 ? (
              driverCodes.map((code) => <option key={code} value={code}>{code}</option>)
            ) : (
              <>
                <option value="NOR">NOR</option>
                <option value="LEC">LEC</option>
              </>
            )}
          </select>
          <button
            onClick={fetchComparison}
            disabled={loading}
            className="bg-f1-cyan hover:bg-f1-cyan/85 text-black font-bold px-3 py-1 rounded transition-colors text-[10px]"
          >
            {loading ? "LOAD..." : "COMPARE"}
          </button>
        </div>
      </div>

      {/* Plot Area */}
      <div className="flex-1 min-h-[220px] relative">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
          className="w-full h-full cursor-crosshair rounded"
        />
        {hoverIndex !== null && data && hoverIndex < data.driver1.distance.length && (
          <div className="absolute top-2 right-2 bg-black/85 border border-white/10 rounded p-2 text-[10px] font-mono-f1 space-y-1 z-10 pointer-events-none">
            <div className="text-white/40 uppercase">DISTANCE: {Math.round(data.driver1.distance[hoverIndex])}m</div>
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: drivers.find((d) => d.code === d1)?.team_color }}
              />
              <span className="font-bold text-white">{d1}: {Math.round(data.driver1.speed[hoverIndex])} km/h</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: drivers.find((d) => d.code === d2)?.team_color }}
              />
              <span className="font-bold text-white">{d2}: {Math.round(data.driver2.speed[hoverIndex])} km/h</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
