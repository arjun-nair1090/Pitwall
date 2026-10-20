"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import PitWindowPage from "@/components/pitwindow/PitWindowPage";
import { parseRaceParams } from "@/lib/compareParams";

// The link can name a race and a lap (?year=2024&round=14&session=R&lap=20).
function PitWindowFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => {
    const query = new URLSearchParams(params.toString());
    const lap = query.get("lap");
    return { ...parseRaceParams(query), lap: lap !== null && /^\d+$/.test(lap) && Number(lap) > 0 ? Number(lap) : null };
  }, [params]);
  return <PitWindowPage initial={initial} />;
}

export default function PitWindowRoute() {
  return (
    <Suspense fallback={null}>
      <PitWindowFromLink />
    </Suspense>
  );
}
