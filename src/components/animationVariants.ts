import type { Variants } from "framer-motion";

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "tween", ease: "easeOut", duration: 0.3 } },
};

export const buttonHover = {
  scale: 1.03,
  transition: { type: "spring", stiffness: 400, damping: 17 },
};

export const buttonTap = {
  scale: 0.97,
};
