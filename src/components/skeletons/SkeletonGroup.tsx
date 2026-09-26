import React from "react";

export interface SkeletonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Screen-reader-only label announced while the group is visible. Defaults to "Loading". */
  label?: string;
}

/**
 * Wraps a set of decorative `Skeleton` placeholders with `role="status"` and
 * a visually-hidden label, so assistive tech announces the loading state
 * once instead of reading through every individual (aria-hidden) shape.
 */
export const SkeletonGroup: React.FC<SkeletonGroupProps> = ({
  label = "Loading",
  className = "",
  children,
  ...props
}) => {
  return (
    <div role="status" aria-live="polite" className={className} {...props}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
};

SkeletonGroup.displayName = "SkeletonGroup";
