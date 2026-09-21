"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import PedalAnalysis from "@/components/advanced/PedalAnalysis";
import { parseRaceParams } from "@/lib/compareParams";

// The link can name a session (?year=2024&round=14&session=Q).
function AdvancedFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => parseRaceParams(new URLSearchParams(params.toString())), [params]);
  return <PedalAnalysis initial={initial} />;
}

export default function AdvancedAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AdvancedFromLink />
    </Suspense>
  );
}
