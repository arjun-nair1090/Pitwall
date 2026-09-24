import Skeleton, { Loading } from "@/components/ui/Skeleton";

export default function WorkspaceSkeleton() {
  return (
    <Loading label="Loading workspace">
      <div className="grid gap-3 lg:grid-cols-12">
        <Skeleton className="h-[560px] lg:col-span-5" />
        <div className="grid gap-3 lg:col-span-7">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[280px]" />
        </div>
      </div>
    </Loading>
  );
}
