"use client";

import { useEffect, useState } from "react";
import { FastForward, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import SessionPicker, { type RaceSelection } from "@/components/analysis/SessionPicker";
import ErrorState from "@/components/ErrorState";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import Skeleton from "@/components/ui/Skeleton";
import { useSessionInfo } from "@/hooks/useRaceData";
import { useReplayLap } from "@/hooks/useReplayLap";
import type { RaceParams } from "@/lib/compareParams";
import { clockText } from "@/lib/replay";
import ReplayMap from "./ReplayMap";
import ReplaySidebar from "./ReplaySidebar";

const SPEEDS = [1, 2, 5, 10, 20] as const;
const RACE_ONLY = ["R"] as const;

// Watch a past race lap by lap on the circuit. Each lap is replayed as the leader ran it, with every
// car where it really was, so the gaps are the true gaps. The next lap loads while this one plays,
// and at the line the replay rolls straight on into it. 1x is real time.
export default function ReplayView({ initial }: { initial: RaceParams }) {
  const [sel, setSel] = useState<RaceSelection>({ year: initial.year, round: initial.round, session: "R" });
  const [lapNo, setLapNo] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(5);
  const [selected, setSelected] = useState<string | null>(null);

  const info = useSessionInfo(sel.year, sel.round, "R");
  const totalLaps = info.status === "ready" ? info.data.total_laps : null;
  const replay = useReplayLap(sel.year, sel.round, lapNo, totalLaps);
  const lap = replay.status === "ready" ? replay.data : null;

  // A different race starts again from lap 1.
  useEffect(() => {
    setLapNo(1);
    setSeconds(0);
    setSelected(null);
  }, [sel.year, sel.round]);

  // The clock: runs only while a lap is on screen, so a slow lap load never skips time.
  useEffect(() => {
    if (!playing || !lap) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setSeconds((s) => s + dt * speed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, lap, speed]);

  // At the line: roll into the next lap, or stop after the last.
  useEffect(() => {
    if (!lap || seconds < lap.duration) return;
    if (lapNo < lap.total_laps) {
      setLapNo(lapNo + 1);
      setSeconds(0);
    } else {
      setSeconds(lap.duration);
      setPlaying(false);
    }
  }, [seconds, lap, lapNo]);

  const goToLap = (n: number) => {
    setLapNo(n);
    setSeconds(0);
  };
  const shown = lap ? Math.min(seconds, lap.duration) : 0;

  return (
    <>
      <Panel title="Choose a race" className="mb-4">
        <div className="p-4">
          <SessionPicker value={sel} onChange={setSel} showSession={false} allowedSessions={RACE_ONLY} />
        </div>
      </Panel>

      {info.status === "error" ? (
        <ErrorState title="Couldn't load this race" message={info.message} onRetry={info.notFound ? undefined : info.retry} />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel
            title={info.status === "ready" ? `${info.data.event_name} ${sel.year}` : "Replay"}
            meta={totalLaps ? `Lap ${lapNo} of ${totalLaps}` : undefined}
          >
            <div className="flex flex-col gap-3 p-4">
              <div className="relative flex min-h-[320px] items-center justify-center">
                {replay.status === "error" ? (
                  <ErrorState title="Couldn't load this lap" message={replay.message} onRetry={replay.notFound ? undefined : replay.retry} />
                ) : lap ? (
                  <ReplayMap lap={lap} seconds={shown} selected={selected} onSelect={setSelected} />
                ) : (
                  <div role="status" className="flex w-full flex-col items-center gap-3 text-sm text-mute">
                    <span>{sel.round === null ? "Loading the season's races…" : `Loading lap ${lapNo}. The first lap of a race can take up to a minute.`}</span>
                    <Skeleton className="h-64 w-full max-w-md" />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t border-gantry pt-3">
                <IconButton label="Previous lap" disabled={lapNo <= 1} onClick={() => goToLap(lapNo - 1)}>
                  <SkipBack aria-hidden className="h-4 w-4" />
                </IconButton>
                <Button variant="primary" onClick={() => setPlaying((p) => !p)} disabled={!lap} className="w-28">
                  {playing ? <Pause aria-hidden className="h-4 w-4 fill-current" /> : <Play aria-hidden className="h-4 w-4 fill-current" />}
                  {playing ? "Pause" : "Play"}
                </Button>
                <IconButton label="Next lap" disabled={totalLaps === null || lapNo >= totalLaps} onClick={() => goToLap(lapNo + 1)}>
                  <SkipForward aria-hidden className="h-4 w-4" />
                </IconButton>
                <Button size="sm" variant="secondary" aria-label={`Playback speed ${speed}x. Change speed`} onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
                  <FastForward aria-hidden className="h-3.5 w-3.5" />
                  {speed}x
                </Button>
                <div className="flex items-end gap-2">
                  <Select label="Lap" value={lapNo} disabled={totalLaps === null} onChange={(e) => goToLap(Number(e.target.value))} selectClassName="w-24 tabular-nums">
                    {Array.from({ length: totalLaps ?? 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                  <span className="pb-2.5 text-xs text-mute">{totalLaps ? `of ${totalLaps}` : ""}</span>
                </div>
                <div className="flex min-w-[10rem] flex-1 items-center gap-3 pb-2">
                  <input
                    type="range"
                    aria-label="Position in the lap"
                    min={0}
                    max={lap?.duration ?? 1}
                    step={0.1}
                    value={shown}
                    disabled={!lap}
                    onChange={(e) => setSeconds(Number(e.target.value))}
                    className="h-2 flex-1 cursor-pointer accent-chalk"
                  />
                  <span className="w-20 text-right text-xs tabular-nums text-mute">{clockText(shown)} of {clockText(lap?.duration ?? 0)}</span>
                </div>
              </div>
            </div>
          </Panel>

          {lap && <ReplaySidebar lap={lap} seconds={shown} selected={selected} onSelect={setSelected} />}
        </div>
      )}
    </>
  );
}
