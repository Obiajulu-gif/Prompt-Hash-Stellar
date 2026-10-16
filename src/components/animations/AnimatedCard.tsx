import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cardVariants, cardHover } from "./variants";

interface AnimatedCardProps {
  children: ReactNode;
  className?: string;
  /**
   * Set to false to disable the hover lift effect (e.g. for non-interactive cards).
   * Defaults to true.
   */
  interactive?: boolean;
}

/**
 * AnimatedCard
 *
 * A motion wrapper for prompt cards (or any card-shaped element).
 * Place it inside a StaggerContainer and it will automatically animate
 * in with a staggered delay relative to its siblings.
 *
 * Usage:
 *
 *   <StaggerContainer>
 *     {prompts.map((p) => (
 *       <AnimatedCard key={p.id}>
 *         <PromptCard prompt={p} />
 *       </AnimatedCard>
 *     ))}
 *   </StaggerContainer>
 */
export default function AnimatedCard({
  children,
  className,
  interactive = true,
}: AnimatedCardProps) {
  return (
    <motion.div
      variants={cardVariants}
      whileHover={interactive ? cardHover : undefined}
      className={className}
      // cursor hint so users know the card is interactive
      style={interactive ? { cursor: "pointer" } : undefined}
    >
      {children}
    </motion.div>
  );
}