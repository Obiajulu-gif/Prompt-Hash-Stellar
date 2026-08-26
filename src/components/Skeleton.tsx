import React from "react";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export const Skeleton: React.FC<SkeletonProps> = React.memo(({ className = "", ...props }) => {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse motion-reduce:animate-none rounded-md bg-slate-800/50 border border-white/5 ${className}`}
      {...props}
    />
  );
});

Skeleton.displayName = "Skeleton";