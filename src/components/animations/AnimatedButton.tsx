import { motion } from "framer-motion";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { buttonHover, buttonTap } from "./variants";

type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onDragCapture"
  | "onDragStartCapture"
  | "onDragEndCapture"
  | "onDragLeave"
  | "onDragLeaveCapture"
  | "onDragOver"
  | "onDragOverCapture"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onAnimationStartCapture"
  | "onAnimationEndCapture"
  | "onAnimationIterationCapture"
  | "onTransitionEnd"
  | "onTransitionEndCapture"
>;

interface AnimatedButtonProps extends NativeButtonProps {
  children: ReactNode;
  /**
   * Extra Tailwind or CSS classes forwarded to the underlying button element.
   */
  className?: string;
}

/**
 * AnimatedButton
 *
 * A drop-in replacement for <button> that adds:
 *  - Scale-up on hover  (1.03×)
 *  - Scale-down on press (0.96×)
 *
 * All native button props (onClick, disabled, type, aria-*, …) pass through.
 *
 * Usage:
 *
 *   <AnimatedButton
 *     className="px-4 py-2 bg-primary-600 text-white rounded-lg"
 *     onClick={handleBuy}
 *   >
 *     Buy Prompt
 *   </AnimatedButton>
 *
 * If you're wrapping a shadcn <Button> component, use the `asChild` pattern
 * or simply apply whileHover / whileTap directly to a motion.div wrapper.
 */
export default function AnimatedButton({
  children,
  className,
  disabled,
  ...rest
}: AnimatedButtonProps) {
  return (
    <motion.button
      whileHover={disabled ? undefined : buttonHover}
      whileTap={disabled ? undefined : buttonTap}
      // Keeps the animation snappy — no spring overshoot on a button
      transition={{ type: "tween" }}
      disabled={disabled}
      className={className}
      {...rest}
    >
      {children}
    </motion.button>
  );
}