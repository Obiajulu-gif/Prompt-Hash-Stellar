import { Skeleton } from "@/components/Skeleton";

/** Matches the final PromptCard layout (src/pages/browse/PromptCard.tsx) so loading grids don't shift. */
export function PromptCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-[24px] border border-white/5 bg-white/[0.02]"
    >
      <Skeleton className="aspect-[16/10] w-full rounded-none bg-white/[0.04]" />
      <div className="flex flex-1 flex-col gap-3 p-4 pt-4 sm:p-6 sm:pt-5">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full bg-white/[0.04]" />
          <Skeleton className="h-5 w-16 rounded-full bg-white/[0.04]" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-5 w-2/3 bg-white/[0.04]" />
          <Skeleton className="h-6 w-14 bg-white/[0.04]" />
        </div>
        <Skeleton className="h-4 w-full bg-white/[0.04]" />
        <Skeleton className="h-4 w-4/5 bg-white/[0.04]" />
        <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-4">
          <Skeleton className="h-4 w-24 bg-white/[0.04]" />
          <Skeleton className="h-4 w-16 bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}

export interface PromptGridSkeletonProps {
  /** Number of card placeholders to render. */
  count?: number;
  /** Grid layout classes — pass the exact classes the loaded grid uses so dimensions match. */
  gridClassName?: string;
}

/** Reusable grid of PromptCardSkeleton placeholders for marketplace/creator catalog routes. */
export function PromptGridSkeleton({
  count = 6,
  gridClassName = "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3",
}: PromptGridSkeletonProps) {
  return (
    <div role="status" aria-live="polite" className={gridClassName}>
      <span className="sr-only">Loading prompts</span>
      {Array.from({ length: count }, (_, index) => (
        <PromptCardSkeleton key={index} />
      ))}
    </div>
  );
}
