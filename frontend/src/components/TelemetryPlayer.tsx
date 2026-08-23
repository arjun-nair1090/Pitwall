"use client";

import React, { useEffect, useState } from "react";
import { useF1Store } from "@/store/useTelemetryStore";
import { Play, Pause, SkipBack, SkipForward, FastForward } from "lucide-react";

export default function TelemetryPlayer() {
  const { replaySession, setReplaySession, replayPlayback, setReplayPlayback } = useF1Store();
  const { isPlaying, speed, frame, maxFrame, currentLap, totalLaps } = replayPlayback;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !replaySession || maxFrame === 0) return null;

  const togglePlay = () => setReplayPlayback({ isPlaying: !isPlaying });

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReplayPlayback({ frame: parseInt(e.target.value, 10) });
  };

  const handleLapChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLap = parseInt(e.target.value, 10);
    // Setting replaySession.lap will trigger TrackMap's useEffect to fetch new lap data
    setReplaySession({ ...replaySession, lap: newLap });
    // Reset frame and pause playback while loading
    setReplayPlayback({ frame: 0, isPlaying: false });
  };

  const cycleSpeed = () => {
    const nextSpeed = speed === 1 ? 2 : speed === 2 ? 5 : speed === 5 ? 10 : 1;
    setReplayPlayback({ speed: nextSpeed });
  };

  const skipForward = () => {
    setReplayPlayback({ frame: Math.min(frame + 100, maxFrame - 1) });
  };

  const skipBackward = () => {
    setReplayPlayback({ frame: Math.max(frame - 100, 0) });
  };

  // Convert frame to an estimated percentage/lap logic if possible, 
  // but simple percentage string works nicely:
  const progressPercent = Math.round((frame / (maxFrame - 1)) * 100) || 0;

  return (
    <div className="glass-panel border-t-2 border-f1-red bg-black/80 backdrop-blur p-4 rounded-t-lg font-titillium w-full shadow-[0_-5px_20px_rgba(225,6,0,0.15)] flex flex-col gap-3">
      {/* Top Header */}
      <div className="flex justify-between items-end">
        <div>
          <h3 className="text-f1-red font-bold text-sm tracking-widest uppercase mb-1 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-f1-red animate-pulse" />
            TELEMETRY REPLAY
          </h3>
          <p className="text-white/70 text-xs font-semibold">
            {replaySession.year} SEASON — {replaySession.gp.toUpperCase()}
          </p>
        </div>
        
        {/* Lap Selector */}
        {totalLaps && currentLap && (
          <div className="flex items-center gap-2 bg-white/5 rounded px-2 py-1">
            <label htmlFor="lap-select" className="text-xs font-bold text-white/50">LAP</label>
            <select 
              id="lap-select" 
              value={currentLap} 
              onChange={handleLapChange}
              className="bg-transparent text-white text-sm font-mono-f1 outline-none border-b border-white/20 focus:border-f1-red cursor-pointer pb-0.5"
            >
              {Array.from({ length: totalLaps }, (_, i) => i + 1).map(lap => (
                <option key={lap} value={lap} className="bg-black text-white">
                  {lap}
                </option>
              ))}
            </select>
            <span className="text-xs text-white/40">/ {totalLaps}</span>
          </div>
        )}

        <div className="text-right">
          <span className="text-xs text-white/50 font-bold bg-white/5 px-2 py-1 rounded">
            {progressPercent}% COMPLETE
          </span>
        </div>
      </div>

      {/* Scrubber */}
      <div className="group relative w-full flex items-center">
        <input
          type="range"
          min="0"
          max={maxFrame - 1}
          value={frame}
          onChange={handleSliderChange}
          className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-0 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-f1-red [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
          style={{
            background: `linear-gradient(to right, #e10600 ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%)`
          }}
        />
      </div>

      {/* Controls */}
      <div className="flex justify-between items-center mt-1">
        <button
          onClick={() => setReplaySession(null)}
          className="text-[10px] text-white/40 hover:text-white font-bold transition-colors px-2 py-1 border border-white/10 rounded hover:bg-white/10"
        >
          EXIT REPLAY
        </button>

        <div className="flex items-center gap-4">
          <button onClick={skipBackward} className="text-white/50 hover:text-white transition-colors">
            <SkipBack className="h-4 w-4" />
          </button>
          
          <button
            onClick={togglePlay}
            className="h-10 w-10 bg-f1-red text-white rounded-full flex items-center justify-center hover:bg-red-700 transition-colors shadow-lg hover:scale-105 active:scale-95"
          >
            {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-1" />}
          </button>

          <button onClick={skipForward} className="text-white/50 hover:text-white transition-colors">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={cycleSpeed}
          className="text-xs font-bold text-f1-yellow bg-f1-yellow/10 px-2 py-1 border border-f1-yellow/20 rounded hover:bg-f1-yellow/20 transition-colors flex items-center gap-1 min-w-[50px] justify-center"
        >
          <FastForward className="h-3 w-3" />
          {speed}x
        </button>
      </div>
    </div>
  );
}
