import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "react-router-dom";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Wraps page-level content with a fade-in/fade-out transition keyed on the
 * current route pathname.  When the user prefers reduced motion the transition
 * is skipped entirely (#336).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <>{children}</>;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
