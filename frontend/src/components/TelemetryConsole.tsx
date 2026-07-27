"use client";

import React, { useMemo } from "react";
import { useF1Store } from "@/store/useTelemetryStore";

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
      <div className="glass-panel rounded-lg p-4 h-full flex flex-col justify-center items-center text-center border border-white/5">
        <p className="text-xs text-white/40 font-mono-f1">
          SELECT A DRIVER FROM TIMING BOARD FOR REAL-TIME TELEMETRY GAUGE
        </p>
      </div>
    );
  }

  // Fallback to static but realistic zero values if no telemetry packet received yet
  const speed = liveTel?.speed ?? 0;
  const rpm = liveTel?.rpm ?? 0;
  const gear = liveTel?.gear ?? 0;
  const throttle = liveTel?.throttle ?? 0;
  const brake = liveTel?.brake ?? 0;
  const drs = liveTel?.drs ?? 0;

  // RPM percentage for bar (F1 cars rev limit around 15000, redline at 12000)
  const rpmPercentage = Math.min(100, (rpm / 15000) * 100);

  return (
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col justify-between border border-white/5 font-mono-f1">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-wider text-f1-green uppercase flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-f1-green animate-pulse" />
            Live Telemetry: {driver.full_name} ({driver.code})
          </h2>
          <span
            className="text-xs px-2 py-0.5 rounded font-bold"
            style={{
              backgroundColor: driver.team_color,
              color: "#ffffff",
              textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            }}
          >
            {driver.team_name}
          </span>
        </div>

        {/* RPM Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-[10px] text-white/50 mb-1">
            <span>RPM: {rpm}</span>
            <span>15,000 LIMIT</span>
          </div>
          <div className="h-3 w-full bg-white/5 rounded-sm overflow-hidden flex">
            <div
              className={`h-full transition-all duration-100 ${
                rpm > 12000 ? "bg-f1-red" : rpm > 9000 ? "bg-f1-yellow" : "bg-f1-green"
              }`}
              style={{ width: `${rpmPercentage}%` }}
            />
          </div>
        </div>

        {/* Core Stats Grid */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          {/* Gear Display */}
          <div className="bg-white/5 rounded p-3 flex flex-col items-center justify-center border border-white/5">
            <span className="text-[10px] text-white/40 mb-1">GEAR</span>
            <span className="text-4xl font-bold text-white">
              {gear === 0 ? "N" : gear}
            </span>
          </div>

          {/* Speed Display */}
          <div className="bg-white/5 rounded p-3 flex flex-col items-center justify-center border border-white/5">
            <span className="text-[10px] text-white/40 mb-1">SPEED</span>
            <span className="text-4xl font-bold text-white">{Math.round(speed)}</span>
            <span className="text-[9px] text-white/40">KM/H</span>
          </div>

          {/* DRS Status */}
          <div className="bg-white/5 rounded p-3 flex flex-col items-center justify-center border border-white/5">
            <span className="text-[10px] text-white/40 mb-1">DRS</span>
            <span
              className={`text-lg font-bold px-3 py-1 rounded ${
                drs === 1 || drs === 12 || drs === 14
                  ? "bg-f1-green/20 text-f1-green animate-pulse"
                  : "bg-white/10 text-white/30"
              }`}
            >
              {drs === 1 || drs === 12 || drs === 14 ? "ACTIVE" : "OFF"}
            </span>
          </div>
        </div>

        {/* Throttle & Brake Pedals */}
        <div className="space-y-3">
          {/* Throttle Bar */}
          <div>
            <div className="flex justify-between text-[10px] text-white/60 mb-0.5">
              <span>THROTTLE</span>
              <span>{Math.round(throttle)}%</span>
            </div>
            <div className="h-2 w-full bg-white/5 rounded-sm overflow-hidden">
              <div
                className="h-full bg-f1-green transition-all duration-100"
                style={{ width: `${throttle}%` }}
              />
            </div>
          </div>

          {/* Brake Bar */}
          <div>
            <div className="flex justify-between text-[10px] text-white/60 mb-0.5">
              <span>BRAKE</span>
              <span>{Math.round(brake)}%</span>
            </div>
            <div className="h-2 w-full bg-white/5 rounded-sm overflow-hidden">
              <div
                className="h-full bg-f1-red transition-all duration-100"
                style={{ width: `${brake}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="text-[10px] text-white/30 mt-3 pt-2 border-t border-white/5 flex justify-between">
        <span>PACKET TIMESTAMP: {liveTel ? new Date(liveTel.timestamp).toLocaleTimeString() : "WAITING"}</span>
        <span>LATENCY: ~20ms</span>
      </div>
    </div>
  );
}
