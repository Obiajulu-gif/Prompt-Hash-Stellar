import { Skeleton } from "@/components/Skeleton";
import { SkeletonGroup } from "./SkeletonGroup";

/** Matches the final prompt detail layout (src/pages/prompts/PromptDetailPage.tsx). */
export function PromptDetailSkeleton() {
  return (
    <SkeletonGroup
      label="Loading prompt"
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1419]"
    >
      <Skeleton className="aspect-[1200/630] w-full rounded-none bg-white/[0.04]" aria-hidden="true" />
      <div className="space-y-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-24 rounded-full bg-white/[0.04]" />
          <Skeleton className="h-6 w-20 rounded-full bg-white/[0.04]" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-8 w-3/4 bg-white/[0.04]" />
          <Skeleton className="h-4 w-full bg-white/[0.04]" />
          <Skeleton className="h-4 w-5/6 bg-white/[0.04]" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Skeleton className="h-4 w-28 bg-white/[0.04]" />
          <Skeleton className="h-4 w-20 bg-white/[0.04]" />
          <Skeleton className="h-4 w-24 bg-white/[0.04]" />
        </div>
        <div className="border-t border-white/10 pt-5">
          <Skeleton className="h-10 w-full bg-white/[0.04]" />
        </div>
      </div>
    </SkeletonGroup>
  );
}
