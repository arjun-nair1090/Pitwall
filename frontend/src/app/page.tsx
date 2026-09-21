import Link from "next/link";
import {
  Radio,
  Map,
  Activity,
  FlaskConical,
  Newspaper,
  Target,
  Trophy,
  Archive,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  { href: "/live", title: "Live Timing", blurb: "Positions, gaps and tyre ages as they happen, with an AI race engineer on the radio.", icon: Radio },
  { href: "/map", title: "Track Map", blurb: "Every car on the circuit in real time, or replay a full race lap by lap.", icon: Map },
  { href: "/compare", title: "Head to Head", blurb: "Overlay two drivers' fastest laps and see exactly where the time was won.", icon: Activity },
  { href: "/strategy", title: "Strategy Simulator", blurb: "Test a tyre strategy against a real session's own degradation data.", icon: FlaskConical },
  { href: "/debrief", title: "Race Debrief", blurb: "Auto-written race summaries, plus what-if counterfactuals on real strategies.", icon: Newspaper },
  { href: "/predictions", title: "Predictions", blurb: "Call the podium before lights-out and climb the season leaderboard.", icon: Target },
  { href: "/stats", title: "Season Stats", blurb: "Championship standings for every driver and constructor since 2018.", icon: Trophy },
  { href: "/archive", title: "Archives", blurb: "Browse past seasons, calendars and race results.", icon: Archive },
];

// The one page where the animated 3D backdrop (BackgroundScene) is shown; every
// data-dense page gets a flat background instead.
export default function LandingPage() {
  return (
    <div className="w-full max-w-6xl mx-auto py-8 md:py-16 space-y-12 md:space-y-16 animate-fade-in">
      <section className="text-center space-y-6">
        <p className="text-xs font-bold tracking-[0.3em] text-f1-red uppercase">Formula 1 telemetry &amp; strategy</p>
        <h1 className="text-5xl md:text-7xl font-black italic tracking-tighter text-white uppercase">
          <span className="text-f1-red">F1</span> Pit Wall
        </h1>
        <p className="max-w-2xl mx-auto text-base md:text-lg text-white/60 font-titillium leading-relaxed">
          Live timing, lap-by-lap telemetry, tyre strategy and an AI race engineer that has read
          every session since 2018 — all in one place.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/live"
            className="inline-flex items-center gap-2 bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-3 px-8 rounded-md transition-colors"
          >
            Open live timing <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/debrief"
            className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/15 text-white font-titillium font-bold py-3 px-8 rounded-md transition-colors"
          >
            Read a race debrief
          </Link>
        </div>
      </section>

      <section aria-label="Features" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {FEATURES.map(({ href, title, blurb, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="glass-panel group p-5 rounded-xl border border-white/5 hover:border-f1-red/50 transition-colors flex flex-col gap-3"
          >
            <Icon className="w-6 h-6 text-f1-red" />
            <h2 className="text-white font-bold font-titillium uppercase tracking-wide">{title}</h2>
            <p className="text-sm text-white/50 font-titillium leading-relaxed flex-1">{blurb}</p>
            <span className="text-xs font-bold text-white/30 group-hover:text-f1-red transition-colors flex items-center gap-1 uppercase">
              Open <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
