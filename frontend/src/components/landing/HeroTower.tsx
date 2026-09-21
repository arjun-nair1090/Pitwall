"use client";

import { useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import Button, { buttonClass } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { winnerCaption, type LatestResult } from "@/lib/latestResult";
import { markIntroSeen, readIntroPreference } from "./introPreference";
import RaceTower from "./RaceTower";
import StartLights from "./StartLights";
import { useLatestResult } from "./useLatestResult";
import { useStartSequence } from "./useStartSequence";

function Sequence({ data, instant }: { data: LatestResult; instant: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const { lit, stage, skip } = useStartSequence({ instant });
  useEffect(() => {
    if (!instant) markIntroSeen(window);
  }, [instant]);

  return (
    <Panel
      title={`${data.event} ${data.year}`}
      meta="Final classification"
      actions={stage !== "done" ? <Button size="sm" variant="ghost" onClick={skip}>Skip intro</Button> : undefined}
    >
      <div className="flex h-16 items-center border-b border-gantry px-4">
        {stage === "done" ? (
          <p className="text-sm text-mute">{winnerCaption(data.classification)}</p>
        ) : (
          <StartLights lit={lit} />
        )}
      </div>
      <RaceTower
        rows={data.classification}
        phase={stage === "lights" ? "grid" : "finish"}
        reducedMotion={reduced || instant}
        label={`Final classification, ${data.event} ${data.year}`}
      />
      <div className="border-t border-gantry px-4 py-3">
        <Link
          href={`/debrief?year=${data.year}&race=${encodeURIComponent(data.event)}`}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          Read the race debrief
        </Link>
      </div>
    </Panel>
  );
}

export default function HeroTower() {
  const latest = useLatestResult();
  const [preference, setPreference] = useState<"pending" | "play" | "skip">("pending");
  useEffect(() => setPreference(readIntroPreference(window)), []);

  if (latest.status === "error") {
    return (
      <Panel title="Latest race" meta="Final classification">
        <EmptyState
          title={latest.empty ? "No results yet" : "Couldn't load the latest race"}
          description={latest.message}
          action={latest.empty ? undefined : <Button onClick={latest.retry}>Try again</Button>}
        />
      </Panel>
    );
  }
  if (latest.status === "loading" || preference === "pending") {
    return (
      <Panel title="Latest race" meta="Loading">
        <Loading label="Loading the latest race">
          <div className="space-y-2 p-4">
            {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        </Loading>
      </Panel>
    );
  }
  return <Sequence data={latest.data} instant={preference === "skip"} />;
}
