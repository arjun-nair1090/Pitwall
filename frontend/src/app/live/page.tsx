"use client";

import dynamic from "next/dynamic";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import AIEngineerConsole from "@/components/AIEngineerConsole";
import ChartSkeleton from "@/components/charts/ChartSkeleton";
import LiveTiming from "@/components/LiveTiming";
import RaceStrategyPanel from "@/components/live/RaceStrategyPanel";
import SessionNotice from "@/components/live/SessionNotice";
import TeamRadioConsole from "@/components/TeamRadioConsole";
import TelemetryConsole from "@/components/TelemetryConsole";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import type { WorkspacePanelDef } from "@/components/workspace/Workspace";
import WorkspaceSkeleton from "@/components/workspace/WorkspaceSkeleton";
import type { Layouts } from "@/lib/layoutStore";

const GapEvolutionChart = dynamic(() => import("@/components/GapEvolutionChart"), { ssr: false, loading: () => <ChartSkeleton height="100%" /> });
const Workspace = dynamic(() => import("@/components/workspace/Workspace"), { ssr: false, loading: () => <WorkspaceSkeleton /> });

const PANELS: WorkspacePanelDef[] = [
  { id: "timing", title: "Race tower", render: () => <LiveTiming /> },
  { id: "strategy", title: "Battles and pit stops", render: () => <RaceStrategyPanel /> },
  { id: "gaps", title: "Gap evolution", render: () => <GapEvolutionChart /> },
  { id: "telemetry", title: "Telemetry", render: () => <TelemetryConsole /> },
  { id: "engineer", title: "Race engineer", render: () => <AIEngineerConsole /> },
  { id: "radio", title: "Team radio and race control", render: () => <TeamRadioConsole /> },
];

const DEFAULT_LAYOUTS: Layouts = {
  lg: [
    { i: "timing", x: 0, y: 0, w: 5, h: 14 },
    { i: "gaps", x: 0, y: 14, w: 5, h: 5 },
    { i: "strategy", x: 5, y: 0, w: 7, h: 9 },
    { i: "telemetry", x: 5, y: 9, w: 7, h: 6 },
    { i: "engineer", x: 5, y: 15, w: 7, h: 8 },
    { i: "radio", x: 0, y: 19, w: 12, h: 5 },
  ],
  sm: [
    { i: "timing", x: 0, y: 0, w: 1, h: 9 },
    { i: "strategy", x: 0, y: 9, w: 1, h: 9 },
    { i: "gaps", x: 0, y: 18, w: 1, h: 5 },
    { i: "telemetry", x: 0, y: 23, w: 1, h: 6 },
    { i: "engineer", x: 0, y: 29, w: 1, h: 8 },
    { i: "radio", x: 0, y: 37, w: 1, h: 5 },
  ],
};

export default function LiveDashboardPage() {
  const [resetKey, setResetKey] = useState(0);
  return (
    <>
      <PageHeader
        title="Live timing"
        description="Positions, gaps, battles and pit stops as the session runs. Drag a panel by its title to rearrange it."
        actions={
          <Button variant="ghost" onClick={() => setResetKey((k) => k + 1)}>
            <RotateCcw aria-hidden className="h-4 w-4" />
            Reset layout
          </Button>
        }
      />
      <SessionNotice />
      <Workspace name="live" panels={PANELS} defaults={DEFAULT_LAYOUTS} resetKey={resetKey} />
    </>
  );
}
