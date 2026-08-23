"use client";

import React from "react";
import LiveTiming from "@/components/LiveTiming";
import TelemetryConsole from "@/components/TelemetryConsole";
import AIEngineerConsole from "@/components/AIEngineerConsole";
import TeamRadioConsole from "@/components/TeamRadioConsole";

export default function LiveDashboardPage() {
  return (
    <div className="flex-1 flex flex-col gap-4">
      <div className="grid grid-cols-12 gap-4 flex-1">
        {/* Left Side Timing Boards (5 cols) */}
        <div className="col-span-12 xl:col-span-5 h-[calc(100vh-180px)]">
          <LiveTiming />
        </div>

        {/* Right Columns: AI & Telemetry Console (7 cols) */}
        <div className="col-span-12 xl:col-span-7 flex flex-col gap-4">
          <div className="h-[250px]">
            <TelemetryConsole />
          </div>
          <div className="flex-1 h-[calc(100vh-450px)]">
            <AIEngineerConsole />
          </div>
        </div>
      </div>

      {/* Bottom Footer Incident feeds */}
      <div className="h-[100px]">
        <TeamRadioConsole />
      </div>
    </div>
  );
}
