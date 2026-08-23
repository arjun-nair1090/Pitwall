"use client";

import React from "react";
import HistoricalArchive from "@/components/HistoricalArchive";
import TelemetryComparison from "@/components/TelemetryComparison";

export default function ArchivePage() {
  return (
    <div className="flex-1 grid grid-cols-12 gap-4">
      {/* Left Side Archives List (4 cols) */}
      <div className="col-span-12 xl:col-span-4 h-full">
        <HistoricalArchive />
      </div>

      {/* Right Side Telemetry Comparison (8 cols) */}
      <div className="col-span-12 xl:col-span-8 h-full">
        <TelemetryComparison />
      </div>
    </div>
  );
}
