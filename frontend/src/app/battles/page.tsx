"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import BattlesPage from "@/components/battles/BattlesPage";
import { parseRaceParams } from "@/lib/compareParams";

// The link can name a session (?year=2024&round=14&session=S).
function BattlesFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => parseRaceParams(new URLSearchParams(params.toString())), [params]);
  return <BattlesPage initial={initial} />;
}

export default function OvertakesPage() {
  return (
    <Suspense fallback={null}>
      <BattlesFromLink />
    </Suspense>
  );
}
