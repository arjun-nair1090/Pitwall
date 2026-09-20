import { GitCommit } from "lucide-react";

interface ChangelogEntry {
  date: string;
  title: string;
  items: string[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-20",
    title: "AI memory, strategy simulation, and shareability",
    items: [
      "AI Race Engineer can now answer cross-season questions (\"how did Verstappen's strategy at Spa compare across recent years\") via a real retrieval pipeline over historical FastF1 data, not just the live session.",
      "New Strategy Simulator: pick a hypothetical tire strategy and get a predicted race time from a degradation model fit to that session's own real lap data.",
      "Shareable result cards and dominance-map PNG export, for sharing a result or a head-to-head comparison outside the app.",
      "Driver season pages with race-by-race insights layered on top of championship standings.",
      "Live mode: gap-to-leader evolution chart, and live alerts for session starts, safety cars, and flag changes.",
      "Stability pass: fixed a duplicate API route, an event-loop-blocking AI call, a broken production build, and patched a critical Next.js vulnerability; added CI so these can't silently regress.",
    ],
  },
  {
    date: "2026-08-24",
    title: "Dominance maps and ghost cars",
    items: [
      "Track dominance maps comparing two drivers' pace mini-sector by mini-sector.",
      "Ghost-car overlay: watch both drivers' cars move around the circuit in sync with the telemetry.",
    ],
  },
  {
    date: "2026-08-23",
    title: "UI overhaul",
    items: [
      "Reworked head-to-head comparison with per-lap selection.",
      "Mini race replay: watch a full session unfold lap by lap.",
    ],
  },
  {
    date: "2026-07-28",
    title: "Live telemetry",
    items: [
      "Real-time car telemetry and timing over WebSockets.",
    ],
  },
  {
    date: "2026-07-27",
    title: "Initial release",
    items: [
      "F1 Pit Wall launches: historical telemetry comparison, season stats, and the AI Race Engineer.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div className="border-b border-white/10 pb-6">
        <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
          <GitCommit className="w-8 h-8 text-f1-red" />
          Changelog
        </h1>
        <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
          What's new on F1 Pit Wall
        </p>
      </div>

      <div className="space-y-10">
        {CHANGELOG.map((entry) => (
          <div key={entry.date} className="relative pl-8 border-l border-white/10">
            <div className="absolute left-[-5px] top-1 h-2.5 w-2.5 rounded-full bg-f1-red" />
            <div className="text-xs text-white/40 font-mono-f1 uppercase tracking-widest mb-1">{entry.date}</div>
            <h2 className="text-xl font-bold text-white font-titillium mb-3">{entry.title}</h2>
            <ul className="space-y-2">
              {entry.items.map((item, i) => (
                <li key={i} className="text-sm text-white/60 font-titillium leading-relaxed flex gap-2">
                  <span className="text-f1-red shrink-0">—</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
