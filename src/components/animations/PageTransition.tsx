import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { pageVariants } from "./variants";

interface PageTransitionProps {
  children: ReactNode;
  /**
   * Pass the current route pathname as the key so Framer Motion knows
   * when to trigger exit → enter animations.
   * This is set automatically by App.tsx.
   */
  routeKey: string;
}

/**
 * PageTransition
 *
 * Wraps the content of every page with an enter/exit animation.
 * Mount this *inside* AnimatePresence (handled in App.tsx) so exit
 * animations actually play before the next page mounts.
 *
 * Usage (App.tsx handles this automatically):
 *
 *   <AnimatePresence mode="wait">
 *     <PageTransition routeKey={location.pathname}>
 *       <YourPage />
 *     </PageTransition>
 *   </AnimatePresence>
 */
export default function PageTransition({ children, routeKey }: PageTransitionProps) {
  return (
    <motion.div
      key={routeKey}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      // Full-height so the page doesn't collapse during the exit animation
      style={{ minHeight: "100%" }}
    >
      {children}
    </motion.div>
  );
}