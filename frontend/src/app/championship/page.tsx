"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import ChampionshipPage from "@/components/championship/ChampionshipPage";
import { parseChampionshipParams } from "@/lib/championship";

// The link can name a season and a round (?year=2024&round=14).
function ChampionshipFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => parseChampionshipParams(new URLSearchParams(params.toString())), [params]);
  return <ChampionshipPage initial={initial} />;
}

export default function ChampionshipOddsPage() {
  return (
    <Suspense fallback={null}>
      <ChampionshipFromLink />
    </Suspense>
  );
}
