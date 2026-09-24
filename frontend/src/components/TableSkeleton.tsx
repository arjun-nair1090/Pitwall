import React from "react";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  title?: boolean;
}

// Placeholder shaped like the data table it stands in for, so layout doesn't
// jump when the real rows arrive.
export default function TableSkeleton({ rows = 8, columns = 4, title = true }: TableSkeletonProps) {
  return (
    <Loading label="Loading">
      <div className="rounded-panel border border-gantry bg-kerb p-6">
        {title && <Skeleton className="mb-6 h-5 w-48" />}
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-center gap-4">
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton key={c} className={cn("h-4", c === 0 ? "w-8" : c === 1 ? "flex-1" : "w-16")} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}
