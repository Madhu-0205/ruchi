"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────
// RUCHI — motion language
// Fast, subtle, intentional. One shared vocabulary for page enter,
// staggered reveals and screen transitions. Every variant respects
// prefers-reduced-motion by rendering instantly.
// ─────────────────────────────────────────────────────────────

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Page-level enter: the screen itself, once. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: "easeIn" } },
};

/** Child stagger: wrap direct children with <StaggerItem />. */
export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.38, ease: EASE } },
};

/**
 * Screen wrapper — page enter/exit + reduced-motion aware.
 * Mount inside <AnimatePresence mode="wait"> in the app shell.
 */
export function PageTransition({
  screenKey,
  children,
}: {
  screenKey: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={screenKey}
      variants={pageVariants}
      initial={reduce ? false : "initial"}
      animate="animate"
      exit={reduce ? undefined : "exit"}
    >
      {children}
    </motion.div>
  );
}

/** One staggered child. Purely presentational. */
export function StaggerItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

/** Container that stagger-reveals its <StaggerItem /> children on mount. */
export function StaggerGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className={className}
    >
      {children}
    </motion.div>
  );
}
