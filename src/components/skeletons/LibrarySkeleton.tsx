import { Skeleton } from "@/components/Skeleton";
import { SkeletonGroup } from "./SkeletonGroup";

/** Matches the buyer library toolbar + row layout (src/components/BuyerLibrary.tsx). */
export function LibrarySkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <SkeletonGroup label="Loading your library" className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <Skeleton className="h-9 flex-1 bg-white/[0.04]" />
        <Skeleton className="h-9 flex-1 bg-white/[0.04]" />
        <Skeleton className="h-9 w-32 bg-white/[0.04]" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex h-32 items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4"
          >
            <Skeleton className="h-full w-24 shrink-0 bg-white/[0.04]" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-2/3 bg-white/[0.04]" />
              <Skeleton className="h-3 w-1/2 bg-white/[0.04]" />
              <Skeleton className="h-3 w-1/3 bg-white/[0.04]" />
            </div>
            <Skeleton className="h-9 w-24 shrink-0 bg-white/[0.04]" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
