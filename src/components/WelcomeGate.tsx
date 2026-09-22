"use client";

// ─────────────────────────────────────────────────────────────
// RUCHI — welcome gate (unauthenticated state)
// ─────────────────────────────────────────────────────────────
// Shown when the session check has settled and no Supabase session
// exists (and the user hasn't chosen guest mode). States the product
// promise in one line, then offers the auth form — with an honest
// anonymous-first exit, because the whole app works without an
// account. Rendered INSTEAD of the main app; no private UI mounts.

import { Camera, Check } from "lucide-react";
import AuthCard from "@/components/AuthCard";
import { RuchiLogo } from "@/components/RuchiLogo";
import { FoodVisual } from "@/components/FoodVisual";
import { getRecipe } from "@/lib/data/recipes";

/** The gate's backdrop dish — a real recipe from the catalog. */
const GATE_RECIPE_ID = "paneer-egg-bhurji";

export default function WelcomeGate({ showGuestExit = true }: { showGuestExit?: boolean }) {
  const backdrop = getRecipe(GATE_RECIPE_ID);

  return (
    <div className="relative mx-auto w-full max-w-md px-4 pb-16 pt-12 sm:pt-16">
      {/* Soft editorial backdrop — one warm plate, half-lifted behind the copy */}
      {backdrop && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-6 -z-10 flex justify-center">
          <FoodVisual
            recipe={backdrop}
            emojiClassName="text-[120px] opacity-[0.12] blur-[1px]"
            className="h-72 w-72 rounded-full"
          />
        </div>
      )}

      {/* Editorial hero */}
      <header className="mb-8 text-center">
        <div className="flex justify-center">
          <div className="relative">
            {/* soft halo behind the mark */}
            <div
              aria-hidden
              className="absolute -inset-6 rounded-full opacity-70"
              style={{
                background:
                  "radial-gradient(closest-side, rgb(228 87 46 / 0.12), transparent)",
              }}
            />
            <RuchiLogo size={72} priority />
          </div>
        </div>
        <h1 className="mt-7 font-display text-display-lg font-semibold">
          Don&apos;t ask what to cook.
          <br />
          <span className="accent-italic text-flame">Show RUCHI what you have.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xs text-[15px] leading-relaxed text-muted">
          Add your ingredients — RUCHI tells you what you can actually cook, step by step.
        </p>
      </header>

      {/* Value line — quiet proof, no fabricated claims */}
      <div className="mx-auto mb-6 flex max-w-sm flex-col gap-2 rounded-3xl border border-line bg-surface/70 px-5 py-4 shadow-soft">
        {[
          { icon: <Camera size={14} />, text: "One photo → tonight's dinner options" },
          { icon: <Check size={14} />, text: "Exact quantities, costs and beginner steps" },
        ].map((row) => (
          <div key={row.text} className="flex items-center gap-2.5 text-[13.5px] font-medium text-ink-soft">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-flame-soft text-flame-deep">
              {row.icon}
            </span>
            {row.text}
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-line bg-surface p-5 shadow-lifted sm:p-6">
        <AuthCard showGuestExit={showGuestExit} />
      </div>

      <p className="mt-6 text-center text-[12px] leading-relaxed text-muted">
        Your kitchen stays on this device unless you sign in to back it up.
      </p>
    </div>
  );
}
