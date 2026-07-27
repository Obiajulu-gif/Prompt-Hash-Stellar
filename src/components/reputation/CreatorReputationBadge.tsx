import { BadgeCheck, Clock, ThumbsUp } from "lucide-react";
import type { CreatorReputation } from "@/lib/reputation/creatorReputation";

export function CreatorVerifiedBadge({
  reputation,
  compact = false,
}: {
  reputation: CreatorReputation;
  compact?: boolean;
}) {
  if (!reputation.verified) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs font-bold text-emerald-200"
      title={reputation.verificationLabel}
    >
      <BadgeCheck className="h-3.5 w-3.5" />
      {compact ? "Verified" : "Verified creator"}
    </span>
  );
}

export function CreatorReputationSummary({
  reputation,
}: {
  reputation: CreatorReputation;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs text-slate-300">
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
        {reputation.totalSales} sales
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
        <ThumbsUp className="h-3.5 w-3.5 text-emerald-300" />
        {reputation.positiveRatings} positive
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
        <Clock className="h-3.5 w-3.5 text-cyan-300" />
        {reputation.timeOnPlatformLabel}
      </span>
    </div>
  );
}
