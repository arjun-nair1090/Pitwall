"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import RacePace from "@/components/pace/RacePace";
import { parseRaceParams } from "@/lib/compareParams";

// The link can name a session (?year=2024&round=14&session=S).
function PaceFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => parseRaceParams(new URLSearchParams(params.toString())), [params]);
  return <RacePace initial={initial} />;
}

export default function RacePacePage() {
  return (
    <Suspense fallback={null}>
      <PaceFromLink />
    </Suspense>
  );
}
