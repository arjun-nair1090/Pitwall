"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import StrategyTool from "@/components/strategy/StrategyTool";
import { parseRaceParams } from "@/lib/compareParams";

// The link can name a race (?year=2024&round=14).
function StrategyFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => parseRaceParams(new URLSearchParams(params.toString())), [params]);
  return <StrategyTool initial={initial} />;
}

export default function StrategySimulatorPage() {
  return (
    <Suspense fallback={null}>
      <StrategyFromLink />
    </Suspense>
  );
}
