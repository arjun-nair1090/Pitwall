"use client";

import React from "react";
import TrackMap from "@/components/TrackMap";
import DriverLiveTelemetry from "@/components/DriverLiveTelemetry";


export default function MapPage() {
  return (
    <div className="flex-1 grid grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      {/* Track Map takes up 9 columns */}
      <div className="col-span-12 xl:col-span-9 h-full">
        <TrackMap />
      </div>

      {/* Driver Telemetry Sidebar takes up 3 columns */}
      <div className="col-span-12 xl:col-span-3 h-full">
        <DriverLiveTelemetry />
      </div>
    </div>
  );
}
