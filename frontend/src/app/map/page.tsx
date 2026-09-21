"use client";

import React from "react";
import DriverLiveTelemetry from "@/components/DriverLiveTelemetry";
import TrackMap from "@/components/TrackMap";
import Panel from "@/components/ui/Panel";
import PageHeader from "@/components/ui/PageHeader";
import { useF1Store } from "@/store/useTelemetryStore";

// Stacked on phones/tablets: the map gets a fixed, generous height and the driver panel flows
// below it at its natural height. Only at xl do the two share a viewport-locked row (dvh, since
// 100vh overshoots on mobile browsers).
export default function MapPage() {
  const replaySession = useF1Store((s) => s.replaySession);
  return (
    <>
      <PageHeader
        title="Track map"
        description="Every car on the circuit in real time, or replay a full race lap by lap."
      />
      <div className="grid flex-1 grid-cols-12 gap-4 md:gap-6 xl:h-[calc(100dvh-13rem)] xl:flex-none">
        <Panel
          title={replaySession ? "Replay" : "Live map"}
          className="col-span-12 h-[60dvh] min-h-[340px] xl:col-span-9 xl:h-full"
          bodyClassName="relative"
        >
          <TrackMap />
        </Panel>
        <Panel title="Driver telemetry" className="col-span-12 min-h-[320px] xl:col-span-3 xl:h-full">
          <DriverLiveTelemetry />
        </Panel>
      </div>
    </>
  );
}
