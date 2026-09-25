/**
 * Verified Badge Component
 * 
 * Displays verification status for creator profiles with trust signals.
 */

import { BadgeCheck } from "lucide-react";
import { Badge } from "./ui/badge";

export interface VerifiedBadgeProps {
  verified: boolean;
  verifiedAt?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function VerifiedBadge({
  verified,
  verifiedAt,
  size = "md",
  showLabel = true,
}: VerifiedBadgeProps) {
  if (!verified) {
    return null;
  }

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : size === "md" ? "h-4 w-4" : "h-5 w-5";
  const textSize = size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-base";

  const formattedDate = verifiedAt
    ? new Date(verifiedAt).toLocaleDateString()
    : undefined;

  return (
    <Badge
      className="border-cyan-300/30 bg-cyan-300/10 text-cyan-100 inline-flex items-center gap-1.5"
      title={formattedDate ? `Verified on ${formattedDate}` : "Verified creator"}
    >
      <BadgeCheck className={iconSize} />
      {showLabel && <span className={textSize}>Verified</span>}
    </Badge>
  );
}

/**
 * Inline verified badge icon (without border)
 */
export function VerifiedIcon({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : size === "md" ? "h-4 w-4" : "h-5 w-5";

  return (
    <BadgeCheck
      className={`${iconSize} text-cyan-400`}
      title="Verified creator"
    />
  );
}
