import type { Variants } from "framer-motion";
import { easeIn, easeOut } from "framer-motion";

// ─── Page-level transitions ───────────────────────────────────────────────────

/** Slides in from slightly below with a fade. Used by PageTransition. */
export const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 16,
    filter: "blur(4px)",
  },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 0.35,
      ease: [0.25, 0.46, 0.45, 0.94], // easeOutQuart
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    filter: "blur(2px)",
    transition: {
      duration: 0.2,
      ease: easeIn,
    },
  },
};

// ─── Stagger container ────────────────────────────────────────────────────────

/**
 * Wrap a list of <AnimatedCard> elements with a motion.div using these variants.
 * The container itself is invisible — it only orchestrates the stagger timing.
 */
export const staggerContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.1,
    },
  },
};

// ─── Card / list item ─────────────────────────────────────────────────────────

/** Individual card entry — fades up into position as part of a stagger. */
export const cardVariants: Variants = {
  initial: {
    opacity: 0,
    y: 24,
    scale: 0.97,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

// ─── Micro-interaction: button ────────────────────────────────────────────────

/** Tap + hover states for buttons. Attach as whileTap / whileHover props. */
export const buttonHover = {
  scale: 1.03,
  transition: { duration: 0.15, ease: easeOut },
};

export const buttonTap = {
  scale: 0.96,
  transition: { duration: 0.1, ease: easeIn },
};

// ─── Micro-interaction: card hover ───────────────────────────────────────────

/** Subtle lift on card hover — gives depth without being distracting. */
export const cardHover = {
  y: -4,
  scale: 1.015,
  transition: { duration: 0.2, ease: easeOut },
};

// ─── Fade-in (generic) ───────────────────────────────────────────────────────

/** Simple fade — useful for modals, tooltips, banners. */
export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.25, ease: easeOut },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15, ease: "easeIn" },
  },
};

// ─── Slide-in from left (sidebar / drawer) ───────────────────────────────────

export const slideInLeftVariants: Variants = {
  initial: { x: -24, opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    x: -24,
    opacity: 0,
    transition: { duration: 0.2, ease: "easeIn" },
  },
};