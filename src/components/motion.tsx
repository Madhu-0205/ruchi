"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { useMemo, type ReactNode } from "react";
import {
  EASE_OUT,
  DURATION,
  SPRING,
  STAGGER_CHILDREN,
  STAGGER_DELAY,
  pageTransition,
} from "@/lib/motion";

// EASE (and the rest of the token set) remain the canonical export,
// defined once in @/lib/motion. Re-exported here for existing imports.
import { EASE } from "@/lib/motion";
export { EASE };

// ─────────────────────────────────────────────────────────────
// RUCHI — motion language
// Fast, subtle, intentional. One shared vocabulary for page enter,
// staggered reveals and screen transitions. Every variant respects
// prefers-reduced-motion by rendering instantly.
// ─────────────────────────────────────────────────────────────

/** Page-level enter: the screen itself, once. */
export const pageVariants: Variants = {
  initial: pageTransition.initial,
  animate: pageTransition.animate as Variants["animate"],
  exit: pageTransition.exit as Variants["exit"],
};

/** Child stagger: wrap direct children with <StaggerItem />. */
export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: STAGGER_CHILDREN, delayChildren: STAGGER_DELAY } },
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

// ─────────────────────────────────────────────────────────────
// Premium primitives — composed from the token system above.
// Each one exists because a screen needed it MORE THAN ONCE.
// ─────────────────────────────────────────────────────────────

/**
 * TextSwap — context/headline replacement motion.
 * Old line exits subtly, new line enters. No scrambling.
 * Reduced motion: instant swap, no transform.
 */
export function TextSwap({
  textKey,
  children,
  className = "",
}: {
  /** Change this to trigger the swap (the new headline). */
  textKey: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <span key={textKey} className={className}>
        {children}
      </span>
    );
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={textKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: DURATION.standard, ease: EASE } }}
        exit={{ opacity: 0, y: -6, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
        className={`block ${className}`}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/**
 * Reveal — one-shot scroll/mount reveal for sections below the fold.
 * Fades + rises once, never re-triggers. Reduced motion: static.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: DURATION.emphasis, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * SpringButton — press compression + spring release for the
 * primary CTA. Wraps children in a motion.span so layouts and
 * class styling stay with the caller. Reduced motion: static span.
 */
export function SpringButton({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{children}</span>;
  return (
    <motion.span
      whileTap={{ scale: 0.97 }}
      transition={SPRING.tactile}
      className={`inline-block ${className}`}
    >
      {children}
    </motion.span>
  );
}

/**
 * Celebration — the ONE restrained celebratory moment (completion).
 * A single soft bloom: ring + a few drifting motes, gold and flame.
 * Apple-calm, not confetti-cannon. Reduced motion: nothing renders.
 */
export function Celebration({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const motes = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        angle: (i / 8) * Math.PI * 2 + 0.35,
        dist: 90 + (i % 3) * 26,
        size: 4 + (i % 3) * 2,
        delay: i * 0.05,
        color: i % 2 === 0 ? "var(--color-gold)" : "var(--color-flame)",
      })),
    [],
  );
  if (!active || reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* Soft bloom ring */}
      <motion.span
        initial={{ scale: 0.4, opacity: 0.5 }}
        animate={{ scale: 2.2, opacity: 0 }}
        transition={{ duration: 1.1, ease: EASE_OUT }}
        className="absolute h-32 w-32 rounded-full"
        style={{ background: "radial-gradient(circle, rgb(185 127 16 / 0.25), transparent 70%)" }}
      />
      {motes.map((m, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
          animate={{
            x: Math.cos(m.angle) * m.dist,
            y: Math.sin(m.angle) * m.dist - 20,
            opacity: [0, 0.9, 0],
            scale: [0.6, 1, 0.7],
          }}
          transition={{ duration: 1.4, delay: m.delay, ease: EASE_OUT }}
          className="absolute rounded-full"
          style={{ width: m.size, height: m.size, background: m.color }}
        />
      ))}
    </div>
  );
}
