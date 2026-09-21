"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FastForward, Pause, Play } from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { readableTextColor } from "@/lib/color";
import { dominanceSegments, lapDuration, positionAtTime, type DuelStyle, type TelemetryPoint } from "@/lib/duel";
import { exportSvgAsPng } from "@/lib/exportSvg";
import { makeProjector } from "@/lib/trackProjection";
import { formatDelta } from "@/lib/timing";

interface DominanceMapProps {
  lap1: readonly TelemetryPoint[];
  lap2: readonly TelemetryPoint[];
  code1: string;
  code2: string;
  style: DuelStyle;
}

const SIZE = 500;
const ASPHALT = "#2A303A";
const RATES = [1, 2, 4] as const;

// Where each driver was quicker round the lap, drawn on the racing line, plus a replay of the two
// laps side by side. The cars are placed by lap time (not by sample number), so the quicker car
// really does pull ahead.
export default function DominanceMap({ lap1, lap2, code1, code2, style }: DominanceMapProps) {
  const segments = useMemo(() => dominanceSegments(lap1, lap2), [lap1, lap2]);
  const project = useMemo(() => makeProjector([...lap1, ...lap2], SIZE, 40), [lap1, lap2]);
  const duration = Math.max(lapDuration(lap1), lapDuration(lap2));

  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setSeconds(0);
    setPlaying(false);
  }, [lap1, lap2]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const step = ((now - last) / 1000) * rate;
      last = now;
      let finished = false;
      setSeconds((s) => {
        const next = s + step;
        if (next >= duration) { finished = true; return duration; }
        return next;
      });
      if (finished) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, rate, duration]);

  if (lap1.length === 0 || lap2.length === 0 || segments.length === 0) {
    return <EmptyState title="No track data" description="Position data wasn't recorded for one of these laps, so the map can't be drawn." />;
  }

  const firstShare = Math.round((segments.filter((s) => s.winner === 1).length / segments.length) * 100);
  const secondShare = 100 - firstShare;
  const carA = positionAtTime(lap1, seconds);
  const carB = positionAtTime(lap2, seconds);
  const toPath = (points: readonly { x: number; y: number }[]) =>
    points.map((p) => { const q = project(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ");

  const marker = (car: { x: number; y: number } | null, code: string, color: string) => {
    if (!car) return null;
    const p = project(car);
    return (
      <g key={code}>
        <circle cx={p.x} cy={p.y} r={7} fill={color} stroke="#E8EBEF" strokeWidth={2} />
        <rect x={p.x + 11} y={p.y - 9} width={32} height={18} rx={3} fill={color} />
        <text x={p.x + 27} y={p.y + 4} fontSize={11} fontWeight={700} textAnchor="middle" fill={readableTextColor(color)}>{code}</text>
      </g>
    );
  };

  const save = async () => {
    if (!svgRef.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      await exportSvgAsPng(svgRef.current, `dominance-${code1}-vs-${code2}.png`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save the image.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="Track dominance map" xmlns="http://www.w3.org/2000/svg" className="mx-auto aspect-square w-full max-w-[520px]">
        <polyline points={toPath(lap1)} fill="none" stroke={ASPHALT} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
        {segments.map((segment, i) => (
          <polyline
            key={i}
            data-sector={i}
            points={toPath(segment.path)}
            fill="none"
            stroke={segment.winner === 1 ? style.color1 : style.color2}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {marker(carB, code2, style.color2)}
        {marker(carA, code1, style.color1)}
      </svg>

      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-mute">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-6 rounded-sm" style={{ backgroundColor: style.color1 }} />
          {code1} faster through {firstShare}% of the lap
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-6 rounded-sm" style={{ backgroundColor: style.color2 }} />
          {code2} faster through {secondShare}% of the lap
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="sm"
          aria-label={playing ? "Pause" : "Play both laps"}
          onClick={() => {
            if (!playing && seconds >= duration) setSeconds(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause aria-hidden className="h-4 w-4 fill-current" /> : <Play aria-hidden className="h-4 w-4 fill-current" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <input
          type="range"
          aria-label="Lap position"
          min={0}
          max={duration}
          step={0.05}
          value={seconds}
          onChange={(e) => { setPlaying(false); setSeconds(Number(e.target.value)); }}
          className="h-2 min-w-[8rem] flex-1 cursor-pointer accent-chalk"
        />
        <span className="w-20 text-right text-xs tabular-nums text-mute" aria-live="off">{seconds.toFixed(1)} s</span>
        <Button size="sm" variant="secondary" aria-label={`Playback speed ${rate}x. Change speed`} onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}>
          <FastForward aria-hidden className="h-3.5 w-3.5" />
          {rate}x
        </Button>
        <Button size="sm" variant="ghost" loading={saving} onClick={save}>
          <Download aria-hidden className="h-3.5 w-3.5" />
          Save image
        </Button>
      </div>
      {saveError && <p role="alert" className="text-xs text-live-text">{saveError}</p>}
      <p className="text-xs text-faint">
        Cars are placed by lap time. {formatDelta(lapDuration(lap2) - lapDuration(lap1)) === "0.000" ? "The laps were equal." : `Gap at the flag: ${formatDelta(lapDuration(lap2) - lapDuration(lap1))} s (positive means ${code1} was quicker).`}
      </p>
    </div>
  );
}
