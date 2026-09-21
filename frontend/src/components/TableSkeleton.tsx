import React from "react";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  title?: boolean;
}

// Placeholder shaped like the data table it stands in for, so layout doesn't
// jump when the real rows arrive.
export default function TableSkeleton({ rows = 8, columns = 4, title = true }: TableSkeletonProps) {
  return (
    <div
      className="glass-panel p-6 rounded-xl border border-white/5 animate-pulse"
      role="status"
      aria-label="Loading"
    >
      {title && <div className="h-5 w-48 bg-white/10 rounded mb-6" />}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4">
            {Array.from({ length: columns }).map((_, c) => (
              <div
                key={c}
                className={`h-4 bg-white/5 rounded ${c === 0 ? "w-8" : c === 1 ? "flex-1" : "w-16"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
