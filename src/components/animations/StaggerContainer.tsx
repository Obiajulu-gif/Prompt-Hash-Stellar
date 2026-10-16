import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { staggerContainerVariants } from "./variants";

interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * StaggerContainer
 *
 * A motion.div that orchestrates staggered entry animations for its
 * AnimatedCard children. Drop it in wherever you render a grid or list
 * of prompt cards.
 *
 * Usage:
 *
 *   <StaggerContainer className="grid grid-cols-3 gap-4">
 *     {prompts.map((p) => (
 *       <AnimatedCard key={p.id}>
 *         <PromptCard prompt={p} />
 *       </AnimatedCard>
 *     ))}
 *   </StaggerContainer>
 */
export default function StaggerContainer({ children, className }: StaggerContainerProps) {
  return (
    <motion.div
      variants={staggerContainerVariants}
      initial="initial"
      animate="animate"
      className={className}
    >
      {children}
    </motion.div>
  );
}