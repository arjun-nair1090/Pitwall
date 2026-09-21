"use client";

import React from "react";
import TrackMap from "@/components/TrackMap";
import DriverLiveTelemetry from "@/components/DriverLiveTelemetry";


// Stacked on phones/tablets: the map gets a fixed, generous height and the
// driver sidebar flows below it at its natural height. Only at xl do the two
// share a viewport-locked row (dvh, since 100vh overshoots on mobile browsers).
export default function MapPage() {
  return (
    <>
    <h1 className="sr-only">Track map</h1>
    <div className="flex-1 grid grid-cols-12 gap-4 md:gap-6 xl:h-[calc(100dvh-140px)]">
      {/* Track Map takes up 9 columns */}
      <div className="col-span-12 xl:col-span-9 h-[60dvh] min-h-[340px] xl:h-full">
        <TrackMap />
      </div>

      {/* Driver Telemetry Sidebar takes up 3 columns */}
      <div className="col-span-12 xl:col-span-3 min-h-[320px] xl:h-full">
        <DriverLiveTelemetry />
      </div>
    </div>
    </>
  );
}
