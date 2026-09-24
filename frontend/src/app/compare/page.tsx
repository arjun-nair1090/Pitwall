"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import CompareTool from "@/components/compare/CompareTool";
import { parseRaceParams } from "@/lib/compareParams";

// The link can name a race (?year=2024&round=14, as the archive's "Compare drivers" does).
function CompareFromLink() {
  const params = useSearchParams();
  const initial = useMemo(() => parseRaceParams(new URLSearchParams(params.toString())), [params]);
  return <CompareTool initial={initial} />;
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareFromLink />
    </Suspense>
  );
}
