"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import WinProbPage from "@/components/winprob/WinProbPage";
import { parseRaceParams } from "@/lib/compareParams";

// The link can name a race and a lap (?year=2024&round=14&session=R&lap=20).
function WinProbFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => {
    const query = new URLSearchParams(params.toString());
    const lap = query.get("lap");
    return { ...parseRaceParams(query), lap: lap !== null && /^\d+$/.test(lap) && Number(lap) > 0 ? Number(lap) : null };
  }, [params]);
  return <WinProbPage initial={initial} />;
}

export default function WinProbRoute() {
  return (
    <Suspense fallback={null}>
      <WinProbFromLink />
    </Suspense>
  );
}
