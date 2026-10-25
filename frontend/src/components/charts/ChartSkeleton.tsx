import Skeleton from "@/components/ui/Skeleton";

// Holds a lazily loaded chart's place at its own height, so the page doesn't jump when Recharts arrives.
export default function ChartSkeleton({ height }: { height: number | string }) {
  return (
    <div style={{ height }} className="w-full">
      <Skeleton className="h-full w-full" />
    </div>
  );
}
