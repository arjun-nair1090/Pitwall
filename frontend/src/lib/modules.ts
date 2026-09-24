import {
  Activity, Archive, FlaskConical, GitCommit, Map as MapIcon, Newspaper, Radio, Target, Trophy, Zap,
  type LucideIcon,
} from "lucide-react";
import { rankMatches, type Searchable } from "./search";

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
  { id: "stats", label: "Season stats", href: "/stats", group: "Analysis", icon: Trophy,
    description: "Championship standings for every driver and constructor since 2018.",
    keywords: ["standings", "championship", "points", "drivers", "constructors"] },
  { id: "debrief", label: "Race debrief", shortLabel: "Debrief", mobilePrimary: true, href: "/debrief", group: "Race", icon: Newspaper,
    description: "Auto-written race summaries, plus what-if counterfactuals on real strategies.",
    keywords: ["summary", "what if", "recap", "results"] },
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

export function searchModules(query: string): AppModule[] {
  return rankMatches(query, MODULES);
}
