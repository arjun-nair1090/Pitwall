"use client";

import React, { useEffect, useState } from "react";
import { useF1Store } from "@/store/useTelemetryStore";
import { Play, Pause, SkipBack, SkipForward, FastForward } from "lucide-react";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Select from "@/components/ui/Select";

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

  const progressPercent = Math.round((frame / (maxFrame - 1)) * 100) || 0;

  return (
    <div className="flex w-full flex-col gap-3 border-t border-gantry bg-kerb p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-chalk">Telemetry replay</h3>
          <p className="text-xs text-mute">
            {replaySession.year} {replaySession.gp}
          </p>
        </div>

        {totalLaps && currentLap && (
          <div className="flex items-end gap-2">
            <Select label="Lap" value={currentLap} onChange={handleLapChange} selectClassName="w-20 tabular-nums">
              {Array.from({ length: totalLaps }, (_, i) => i + 1).map((lap) => (
                <option key={lap} value={lap}>
                  {lap}
                </option>
              ))}
            </Select>
            <span className="pb-2.5 text-xs text-mute">of {totalLaps}</span>
          </div>
        )}

        <p className="text-xs tabular-nums text-mute">{progressPercent}% of the lap</p>
      </div>

      <input
        type="range"
        aria-label="Replay position"
        min="0"
        max={maxFrame - 1}
        value={frame}
        onChange={handleSliderChange}
        className="h-2 w-full cursor-pointer accent-chalk"
      />

      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={() => setReplaySession(null)}>
          Exit replay
        </Button>

        <div className="flex items-center gap-2">
          <IconButton label="Back 100 frames" onClick={skipBackward}>
            <SkipBack aria-hidden className="h-4 w-4" />
          </IconButton>
          <Button variant="primary" onClick={togglePlay} aria-label={isPlaying ? "Pause replay" : "Play replay"} className="w-12 px-0">
            {isPlaying ? <Pause aria-hidden className="h-5 w-5 fill-current" /> : <Play aria-hidden className="h-5 w-5 fill-current" />}
          </Button>
          <IconButton label="Forward 100 frames" onClick={skipForward}>
            <SkipForward aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>

        <Button size="sm" variant="secondary" onClick={cycleSpeed} aria-label={`Playback speed ${speed}x. Change speed`}>
          <FastForward aria-hidden className="h-3.5 w-3.5" />
          {speed}x
        </Button>
      </div>
    </div>
  );
}
