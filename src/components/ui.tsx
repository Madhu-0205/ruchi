"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

// ── Button ──────────────────────────────────────────────────
type BtnVariant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, string> = {
    primary: "bg-ink text-cream hover:bg-black active:scale-[0.98]",
    secondary: "bg-white text-ink border border-line hover:border-muted/40 active:scale-[0.98]",
    ghost: "bg-transparent text-ink hover:bg-black/5 active:scale-[0.98]",
  };
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[15px] font-semibold transition-all disabled:opacity-40 disabled:pointer-events-none ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ── Chip ────────────────────────────────────────────────────
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
      className={`rounded-full px-4 py-2 text-sm font-medium transition-all active:scale-95 ${
        selected
          ? "bg-ink text-cream"
          : "bg-white text-ink border border-line hover:border-ink/30"
      } ${className}`}
    >
      {children}
    </button>
  );
}

// Neutral info banner used for warnings and quiet notes.
export function Note({
  tone = "gold",
  children,
}: {
  tone?: "gold" | "sage" | "flame";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    gold: "border-gold/30 bg-gold-soft text-gold",
    sage: "border-sage/25 bg-sage-soft text-sage",
    flame: "border-flame/25 bg-flame-soft text-flame-deep",
  };
  return (
    <div className={`rounded-2xl border p-4 text-[14px] font-medium leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
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
  return (
    <div
      onClick={onClick}
      className={`rounded-3xl bg-surface border border-line ${onClick ? "cursor-pointer hover:border-ink/25 transition-colors" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

// ── Pill ────────────────────────────────────────────────────
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
    neutral: "bg-black/5 text-ink",
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
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted">{children}</h2>
      {right}
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
      <span className={`text-xl font-bold leading-none ${tones[tone]}`}>{value}</span>
      <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
    </div>
  );
}
