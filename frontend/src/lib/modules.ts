import {
  Activity, Archive, Crown, FlaskConical, Gauge, GitCommit, Map as MapIcon, Newspaper, Radio, Swords, Target, Timer, TrendingUp, Trophy, Zap,
  type LucideIcon,
} from "lucide-react";
import type { Searchable } from "./search";

export type ModuleGroup = "Live" | "Analysis" | "Race" | "Play" | "More";

export interface AppModule extends Searchable {
  id: string;
  description: string;
  href: string;
  group: ModuleGroup;
  icon: LucideIcon;
  shortLabel?: string;
  mobilePrimary?: boolean;
}

export const GROUP_ORDER: ModuleGroup[] = ["Live", "Analysis", "Race", "Play", "More"];

// The single source of truth for navigation. The rail, the mobile tab bar, the
// command palette and the landing page all read this list, so a new module is
// one entry here plus its page.
export const MODULES: AppModule[] = [
  { id: "live", label: "Live timing", shortLabel: "Live", mobilePrimary: true, href: "/live", group: "Live", icon: Radio,
    description: "Positions, gaps and tyre ages as they happen, with an AI race engineer on the radio.",
    keywords: ["race", "tower", "positions", "gaps", "sectors"] },
  { id: "map", label: "Track map", shortLabel: "Map", mobilePrimary: true, href: "/map", group: "Live", icon: MapIcon,
    description: "Every car on the circuit in real time, or replay a full race lap by lap.",
    keywords: ["circuit", "cars", "replay"] },
  { id: "compare", label: "Head to head", shortLabel: "Compare", mobilePrimary: true, href: "/compare", group: "Analysis", icon: Activity,
    description: "Overlay two drivers' fastest laps and see exactly where the time was won.",
    keywords: ["h2h", "compare", "telemetry", "laps", "delta"] },
  { id: "advanced", label: "Advanced analytics", href: "/advanced", group: "Analysis", icon: Zap,
    description: "Throttle, brake and coasting behaviour for every driver across a session.",
    keywords: ["pedal", "throttle", "brake", "coasting", "trail braking"] },
  { id: "strategy", label: "Strategy simulator", href: "/strategy", group: "Analysis", icon: FlaskConical,
    description: "Test a tyre strategy against a real session's own degradation data.",
    keywords: ["tyre", "tire", "pit", "stops", "compound"] },
  { id: "pace", label: "Race pace", href: "/pace", group: "Analysis", icon: Gauge,
    description: "Fuel-corrected race pace for every driver, and how fast each tyre compound wore.",
    keywords: ["pace", "degradation", "tyre wear", "fuel", "long run", "stint"] },
  { id: "stats", label: "Season stats", href: "/stats", group: "Analysis", icon: Trophy,
    description: "Championship standings for every driver and constructor since 2018.",
    keywords: ["standings", "championship", "points", "drivers", "constructors"] },
  { id: "championship", label: "Championship odds", href: "/championship", group: "Analysis", icon: Crown,
    description: "Who can still win the title, and how likely each driver and team is, from a simulation of the races left.",
    keywords: ["title", "odds", "monte carlo", "standings", "simulation", "championship", "chances"] },
  { id: "debrief", label: "Race debrief", shortLabel: "Debrief", mobilePrimary: true, href: "/debrief", group: "Race", icon: Newspaper,
    description: "Auto-written race summaries, plus what-if counterfactuals on real strategies.",
    keywords: ["summary", "what if", "recap", "results"] },
  { id: "battles", label: "Overtakes and battles", href: "/battles", group: "Race", icon: Swords,
    description: "Every on-track pass, places gained at the start, and every fight within a second, for any race since 2018.",
    keywords: ["overtakes", "passes", "battles", "lap chart", "positions", "drs"] },
  { id: "pitwindow", label: "Pit window", href: "/pitwindow", group: "Race", icon: Timer,
    description: "Replay any lap of a past race: each driver's best pit plan, when their window opens, and who could undercut.",
    keywords: ["pit stop", "undercut", "box", "window", "strategy", "overcut"] },
  { id: "winprob", label: "Win probability", href: "/winprob", group: "Race", icon: TrendingUp,
    description: "Replay any race or sprint lap by lap: every driver's chance of winning, and the table behind any lap.",
    keywords: ["win probability", "who wins", "odds", "chance", "simulation", "race win", "favourite"] },
  { id: "archive", label: "Archive", href: "/archive", group: "Race", icon: Archive,
    description: "Browse past seasons, calendars and race results.",
    keywords: ["history", "past", "seasons", "calendar"] },
  { id: "predictions", label: "Predictions", shortLabel: "Predict", mobilePrimary: true, href: "/predictions", group: "Play", icon: Target,
    description: "Call the podium before lights-out and climb the season leaderboard.",
    keywords: ["podium", "leaderboard", "game", "pick"] },
  { id: "changelog", label: "Changelog", href: "/changelog", group: "More", icon: GitCommit,
    description: "What changed in Pit Wall, and when.",
    keywords: ["updates", "release", "changes"] },
];

export function findModuleForPath(pathname: string): AppModule | undefined {
  return MODULES.find((m) => pathname === m.href || pathname.startsWith(`${m.href}/`));
}
