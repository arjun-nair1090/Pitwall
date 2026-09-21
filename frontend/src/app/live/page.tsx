"use client";

import React from "react";
import LiveTiming from "@/components/LiveTiming";
import GapEvolutionChart from "@/components/GapEvolutionChart";
import TelemetryConsole from "@/components/TelemetryConsole";
import AIEngineerConsole from "@/components/AIEngineerConsole";
import TeamRadioConsole from "@/components/TeamRadioConsole";

// Below the xl breakpoint the panels stack into one column and scroll with the
// page, each with its own sensible height. Only at xl do they lock to the
// viewport (dvh, not vh -- 100vh is taller than the visible area on mobile
// browsers because of the collapsing address bar).
export default function LiveDashboardPage() {
  return (
    <div className="flex-1 flex flex-col gap-4">
      <div className="grid grid-cols-12 gap-4 flex-1">
        {/* Left Side: Timing Board + Gap Evolution (5 cols) */}
        <div className="col-span-12 xl:col-span-5 xl:h-[calc(100dvh-180px)] flex flex-col gap-4">
          <div className="h-[460px] xl:h-auto xl:flex-1 min-h-0">
            <LiveTiming />
          </div>
          <div className="h-[260px] shrink-0">
            <GapEvolutionChart />
          </div>
        </div>

        {/* Right Columns: AI & Telemetry Console (7 cols) */}
        <div className="col-span-12 xl:col-span-7 flex flex-col gap-4">
          <div className="min-h-[250px] xl:h-[250px]">
            <TelemetryConsole />
          </div>
          <div className="min-h-[380px] xl:flex-1 xl:h-[calc(100dvh-450px)]">
            <AIEngineerConsole />
          </div>
        </div>
      </div>

      {/* Bottom Footer Incident feeds */}
      <div className="min-h-[100px]">
        <TeamRadioConsole />
      </div>
    </div>
  );
}
