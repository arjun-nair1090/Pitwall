"use client";

import React from "react";
import { useF1Store } from "@/store/useTelemetryStore";
import { Activity } from "lucide-react";

export default function DriverLiveTelemetry() {
  const { telemetry, drivers, selectedDriverNum } = useF1Store();

  const driver = drivers.find((d) => d.driver_number === selectedDriverNum);
  const data = selectedDriverNum ? telemetry[selectedDriverNum] : null;

  if (!selectedDriverNum || !driver) {
    return (
      <div className="glass-panel rounded-lg p-6 h-full flex flex-col items-center justify-center border border-white/5 bg-black/60 text-white/40 text-center">
        <Activity className="h-8 w-8 mb-4 opacity-50" />
        <p className="text-sm font-mono-f1 uppercase tracking-widest">
          Select a driver on the map to view live telemetry
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="glass-panel rounded-lg p-6 h-full flex flex-col items-center justify-center border border-white/5 bg-black/60 text-white/40">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 border-2 border-f1-red border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-xs font-mono-f1">AWAITING TELEMETRY STREAM...</p>
        </div>
      </div>
    );
  }

  // Value bars logic
  const speedPercentage = Math.min((data.speed / 350) * 100, 100);
  const rpmPercentage = Math.min((data.rpm / 15000) * 100, 100);

  return (
    <div className="glass-panel rounded-lg p-6 h-full flex flex-col border border-white/5 bg-black/80 relative overflow-hidden">
      {/* Dynamic Background Glow based on team color */}
      <div 
        className="absolute inset-0 opacity-10 pointer-events-none transition-colors duration-500"
        style={{ background: `radial-gradient(circle at top right, ${driver.team_color}, transparent 60%)` }}
      />

      <div className="relative z-10 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-end mb-8 pb-4 border-b border-white/10">
          <div className="flex items-center gap-4">
            <div 
              className="text-4xl font-black italic tracking-tighter"
              style={{ color: driver.team_color }}
            >
              {driver.driver_number}
            </div>
            <div>
              <h2 className="text-xl font-bold uppercase">{driver.full_name}</h2>
              <div className="text-xs text-white/50 font-mono-f1 uppercase">{driver.team_name}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-white/40 font-mono-f1 uppercase mb-1">Status</div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${data.live_signal !== false ? 'bg-f1-green animate-pulse' : 'bg-white/20'}`} />
              <span className="text-xs font-bold">{data.live_signal !== false ? 'LIVE' : 'OFFLINE'}</span>
            </div>
          </div>
        </div>

        {/* Telemetry Grid */}
        <div className="grid grid-cols-2 gap-6 flex-1">
          
          {/* Speed Block */}
          <div className="bg-white/5 p-4 rounded border border-white/5 flex flex-col justify-between">
            <div className="text-[10px] text-white/50 font-mono-f1 uppercase">Speed</div>
            <div className="text-4xl font-mono-f1 font-bold text-white tracking-tighter">
              {data.speed} <span className="text-sm text-white/40">km/h</span>
            </div>
            <div className="h-1.5 w-full bg-white/10 rounded-full mt-3 overflow-hidden">
              <div 
                className="h-full bg-white transition-all duration-200" 
                style={{ width: `${speedPercentage}%` }}
              />
            </div>
          </div>

          {/* Gear Block */}
          <div className="bg-white/5 p-4 rounded border border-white/5 flex flex-col justify-between">
            <div className="text-[10px] text-white/50 font-mono-f1 uppercase">Gear</div>
            <div className="text-4xl font-mono-f1 font-bold text-f1-cyan tracking-tighter">
              {data.gear === 0 ? 'N' : data.gear}
            </div>
            <div className="h-1.5 w-full bg-transparent mt-3" /> {/* Spacer to match */}
          </div>

          {/* RPM Block */}
          <div className="bg-white/5 p-4 rounded border border-white/5 flex flex-col justify-between col-span-2">
            <div className="flex justify-between items-end mb-2">
              <div className="text-[10px] text-white/50 font-mono-f1 uppercase">Engine RPM</div>
              <div className="text-xl font-mono-f1 font-bold">{data.rpm}</div>
            </div>
            {/* RPM LED Bar */}
            <div className="flex gap-1 h-3 mt-1">
              {Array.from({ length: 15 }).map((_, i) => {
                const isActive = (i + 1) * 1000 <= data.rpm;
                let colorClass = "bg-white/10";
                if (isActive) {
                  if (i < 8) colorClass = "bg-f1-green";
                  else if (i < 13) colorClass = "bg-yellow-400";
                  else colorClass = "bg-f1-red";
                }
                return (
                  <div 
                    key={i} 
                    className={`flex-1 rounded-sm transition-colors duration-75 ${colorClass} ${isActive && i >= 13 ? 'animate-pulse' : ''}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Throttle & Brake Pedals */}
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <div className="text-[10px] text-white/50 font-mono-f1 uppercase flex justify-between">
                <span>Throttle</span>
                <span>{data.throttle}%</span>
              </div>
              <div className="h-8 w-full bg-white/5 rounded overflow-hidden border border-white/10 relative">
                <div 
                  className="absolute bottom-0 left-0 h-full bg-f1-green transition-all duration-75"
                  style={{ width: `${data.throttle}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] text-white/50 font-mono-f1 uppercase flex justify-between">
                <span>Brake</span>
                <span>{data.brake}%</span>
              </div>
              <div className="h-8 w-full bg-white/5 rounded overflow-hidden border border-white/10 relative">
                <div 
                  className="absolute bottom-0 left-0 h-full bg-f1-red transition-all duration-75"
                  style={{ width: `${data.brake}%` }}
                />
              </div>
            </div>
          </div>

          {/* DRS Status */}
          <div className="col-span-2 bg-white/5 p-3 rounded border border-white/5 flex items-center justify-between mt-2">
            <div className="text-[10px] text-white/50 font-mono-f1 uppercase">DRS State</div>
            <div className={`text-xs font-bold px-3 py-1 rounded ${data.drs >= 10 && data.drs <= 14 ? 'bg-f1-green text-black' : 'bg-white/10 text-white/40'}`}>
              {data.drs >= 10 && data.drs <= 14 ? 'OPEN / ACTIVE' : 'CLOSED'}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
