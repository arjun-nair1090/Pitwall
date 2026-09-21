"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import DriverLiveTelemetry from "@/components/DriverLiveTelemetry";
import TrackMap from "@/components/TrackMap";
import ReplayView from "@/components/map/ReplayView";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Tabs, { tabPanelProps } from "@/components/ui/Tabs";
import { parseRaceParams } from "@/lib/compareParams";
import { useF1Store } from "@/store/useTelemetryStore";

const TABS = [
  { id: "replay", label: "Replay a past race" },
  { id: "live", label: "Live" },
] as const;
type View = (typeof TABS)[number]["id"];

function MapViews() {
  const params = useSearchParams();
  const initial = useMemo(() => parseRaceParams(new URLSearchParams(params.toString())), [params]);
  const live = useF1Store((s) => s.isConnected);
  // A link to a race opens the replay; otherwise open on whichever has something to show.
  const [view, setView] = useState<View>(params.get("round") ? "replay" : live ? "live" : "replay");

  return (
    <>
      <PageHeader title="Track map" description="Watch a past race lap by lap with every car where it really was, or follow a live session as it runs." />
      <Tabs idBase="map" label="Map views" className="mb-4" value={view} onChange={(id) => setView(id as View)} tabs={TABS} />
      <div {...tabPanelProps("map", view)}>
        {view === "replay" ? (
          <ReplayView initial={initial} />
        ) : (
          // Stacked on phones and tablets; only at xl do the map and the driver panel share one viewport-high row.
          <div className="grid grid-cols-12 gap-4 md:gap-6 xl:h-[calc(100dvh-16rem)]">
            <Panel title="Live map" className="col-span-12 h-[60dvh] min-h-[340px] xl:col-span-9 xl:h-full" bodyClassName="relative">
              <TrackMap />
            </Panel>
            <Panel title="Driver telemetry" className="col-span-12 min-h-[320px] xl:col-span-3 xl:h-full">
              <DriverLiveTelemetry />
            </Panel>
          </div>
        )}
      </div>
    </>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapViews />
    </Suspense>
  );
}
