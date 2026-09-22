"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

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
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none ${
        size === "lg" ? "px-7 py-4 text-[16px]" : "px-5 py-3 text-[15px]"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </button>
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

// ── Large editorial section heading ─────────────────────────
export function SectionDisplay({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-ink">
      {children}
    </h2>
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
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-cream-deep text-muted">
          {icon}
        </div>
      )}
      <p className="text-[16px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse-soft rounded-2xl bg-ink/[0.06] ${className}`} />;
}
