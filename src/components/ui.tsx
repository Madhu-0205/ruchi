"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { animate, useReducedMotion } from "framer-motion";

// ─────────────────────────────────────────────────────────────
// RUCHI — design primitives
// One shared visual vocabulary: buttons, surfaces, chips, pills,
// section headings, states. Screens compose these; they never
// re-style them from scratch.
// ─────────────────────────────────────────────────────────────

// ── Button ──────────────────────────────────────────────────
type BtnVariant = "primary" | "secondary" | "ghost" | "flame" | "dark";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "md" | "lg";
}) {
  const variants: Record<BtnVariant, string> = {
    primary:
      "bg-ink text-cream hover:bg-ink-soft shadow-soft hover:shadow-lifted active:scale-[0.98]",
    flame:
      "bg-flame text-white hover:bg-flame-deep shadow-cta hover:shadow-lifted active:scale-[0.98]",
    dark: "bg-ink text-cream hover:bg-black shadow-soft active:scale-[0.98]",
    secondary:
      "bg-surface text-ink border border-line hover:border-line-strong shadow-soft hover:shadow-lifted active:scale-[0.98]",
    ghost: "bg-transparent text-ink hover:bg-ink/5 active:scale-[0.98]",
  };
  return (
    <button
      {...rest}
      className={`relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl font-semibold transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none ${
        size === "lg" ? "px-7 py-4 text-[16px]" : "px-5 py-3 text-[15px]"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ── Shimmer sweep (light pass on primary CTAs) ─────────────
// Pure CSS transform animation; sits in the top layer of the button.
// Decorative only — aria-hidden, pointer-events-none.
export function ShimmerSweep({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/35 to-transparent ${className}`}
    />
  );
}

// ── Card ────────────────────────────────────────────────────
export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  // Clickable cards must stay keyboard-accessible: role + Enter/Space + focus
  // ring, without changing the visual language (same div, same classes).
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={`rounded-3xl bg-surface border border-line shadow-soft cursor-pointer transition-all duration-200 hover:border-line-strong hover:shadow-lifted hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame ${className}`}
      >
        {children}
      </div>
    );
  }
  return (
    <div className={`rounded-3xl bg-surface border border-line shadow-soft ${className}`}>
      {children}
    </div>
  );
}

// ── Chip (interactive) ──────────────────────────────────────
export function Chip({
  selected,
  onClick,
  children,
  className = "",
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-95 ${
        selected
          ? "bg-ink text-cream shadow-soft"
          : "bg-surface text-ink border border-line hover:border-line-strong hover:shadow-soft"
      } ${className}`}
    >
      {children}
    </button>
  );
}

// ── Pill (non-interactive metadata) ─────────────────────────
export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "protein" | "savings" | "time" | "sage";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink/[0.055] text-ink-soft",
    protein: "bg-sage-soft text-sage",
    savings: "bg-gold-soft text-gold",
    time: "bg-flame-soft text-flame-deep",
    sage: "bg-sage-soft text-sage",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ── Section header ──────────────────────────────────────────
export function SectionTitle({
  children,
  right,
  as = "h2",
  className = "",
}: {
  children: ReactNode;
  right?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  const Tag = as;
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <Tag className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted">
        {children}
      </Tag>
      {right}
    </div>
  );
}

// ── Eyebrow label — small caps with a flame tick ───────────
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted ${className}`}
    >
      <span aria-hidden className="h-1 w-4 rounded-full bg-flame/70" />
      {children}
    </p>
  );
}

// ── Large editorial section heading ─────────────────────────
export function SectionDisplay({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-ink">
      {children}
    </h2>
  );
}

// ── Full section heading: eyebrow + display + right slot ───
export function SectionHeading({
  eyebrow,
  title,
  right,
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h2 className="font-display text-display-lg font-semibold text-ink">{title}</h2>
      </div>
      {right && <div className="shrink-0 pb-1.5">{right}</div>}
    </div>
  );
}

// ── Typographic metadata line (dot-separated, no pills) ────
export function MetaLine({
  items,
  className = "",
  size = "md",
}: {
  items: (string | ReactNode)[];
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <p
      className={`flex flex-wrap items-center font-medium text-muted ${
        size === "lg" ? "text-[14px]" : "text-[13px]"
      } ${className}`}
    >
      {items.map((it, i) =>
        i < items.length - 1 ? (
          <span key={i} className="flex items-center">
            {it}
            <span aria-hidden className="mx-2 text-line-strong">
              ·
            </span>
          </span>
        ) : (
          <span key={i}>{it}</span>
        ),
      )}
    </p>
  );
}

// ── Number transition — counts smoothly between values ─────
// Springs on change, renders static for reduced-motion users.
// Tabular figures keep layout width stable while counting.
export function NumberFlow({
  value,
  prefix = "",
  suffix = "",
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (reduce || prev.current === value) {
      prev.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

// ── Ring progress — timer ring for Cooking Mode ────────────
export function RingProgress({
  progress,
  size = 120,
  stroke = 6,
  children,
}: {
  /** 0 → 1 remaining fraction. */
  progress: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(250 246 239 / 0.12)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-flame)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// ── Stat block ──────────────────────────────────────────────
export function Stat({
  value,
  label,
  tone = "neutral",
}: {
  value: ReactNode;
  label: string;
  tone?: "neutral" | "protein" | "savings" | "time";
}) {
  const tones: Record<string, string> = {
    neutral: "text-ink",
    protein: "text-sage",
    savings: "text-gold",
    time: "text-flame-deep",
  };
  return (
    <div className="flex flex-col">
      <span className={`text-xl font-bold leading-none tracking-tight ${tones[tone]}`}>
        {value}
      </span>
      <span className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
    </div>
  );
}

// ── Neutral info banner ─────────────────────────────────────
export function Note({
  tone = "gold",
  children,
  className = "",
}: {
  tone?: "gold" | "sage" | "flame";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    gold: "border-gold/25 bg-gold-soft text-gold",
    sage: "border-sage/20 bg-sage-soft text-sage",
    flame: "border-flame/20 bg-flame-soft text-flame-deep",
  };
  return (
    <div
      className={`rounded-2xl border p-4 text-[14px] font-medium leading-relaxed ${tones[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-cream-deep text-muted">
          {icon}
        </div>
      )}
      <p className="font-display text-[18px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse-soft rounded-2xl bg-ink/[0.06] ${className}`} />;
}

// ── Card-grid skeleton (loading rhythm for recipe grids) ───
export function RecipeGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-3xl border border-line bg-surface">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2.5 p-5">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
