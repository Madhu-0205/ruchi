"use client";

import type { Recipe } from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// RUCHI — recipe visuals
// The catalog is emoji-first by design (no external food photos in
// the dataset), so these components give every dish a consistent,
// premium visual identity: deterministic warm gradients keyed off the
// recipe id, generous emoji art, and layered depth. One visual world
// across cards, hero banners and cooking mode.
// ─────────────────────────────────────────────────────────────

const PALETTES: { bg: string; ring: string }[] = [
  { bg: "linear-gradient(135deg, #fceee6 0%, #f7d9c4 55%, #f0c09d 100%)", ring: "rgb(199 67 31 / 0.14)" },
  { bg: "linear-gradient(135deg, #e8f1ea 0%, #d3e5d8 55%, #b9d3c2 100%)", ring: "rgb(67 117 90 / 0.14)" },
  { bg: "linear-gradient(135deg, #fbf2dd 0%, #f3e2b8 55%, #e9cf94 100%)", ring: "rgb(185 127 16 / 0.14)" },
  { bg: "linear-gradient(150deg, #fdf6ec 0%, #f6e3ce 50%, #eccfae 100%)", ring: "rgb(38 32 26 / 0.10)" },
  { bg: "linear-gradient(140deg, #fdece4 0%, #f4d7cd 55%, #e5b8a9 100%)", ring: "rgb(199 67 31 / 0.12)" },
  { bg: "linear-gradient(140deg, #eef3e6 0%, #dde8cc 55%, #c6d6ae 100%)", ring: "rgb(67 117 90 / 0.12)" },
];

/** Deterministic palette index for a recipe — same dish, same look, always. */
export function paletteFor(id: string): { bg: string; ring: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length] ?? PALETTES[0]!;
}

/**
 * Large editorial food visual — the "image" layer for recipe cards and
 * hero banners. Gradient plate + soft ring shadow + oversized emoji.
 * `zoom` enables the hover-scale treatment (cards opt in via a parent
 * `group`); motion is transform-only so it stays cheap.
 */
export function FoodVisual({
  recipe,
  className = "",
  emojiClassName = "text-6xl",
  zoom = false,
}: {
  recipe: Pick<Recipe, "id" | "heroEmoji" | "name">;
  className?: string;
  emojiClassName?: string;
  zoom?: boolean;
}) {
  const palette = paletteFor(recipe.id);
  return (
    <div
      role="img"
      aria-label={recipe.name}
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: palette.bg, boxShadow: `inset 0 0 0 1px ${palette.ring}` }}
    >
      {/* soft inner vignette for depth */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 30% 20%, rgb(255 255 255 / 0.5), transparent 55%), radial-gradient(120% 100% at 80% 90%, rgb(38 32 26 / 0.07), transparent 60%)",
        }}
      />
      {/* gentle top sheen — editorial light source, always the same side */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1/3"
        style={{
          background: "linear-gradient(180deg, rgb(255 255 255 / 0.28), transparent)",
        }}
      />
      <span
        aria-hidden
        className={`relative select-none leading-none transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          zoom ? "group-hover:scale-[1.08]" : ""
        } ${emojiClassName}`}
      >
        {recipe.heroEmoji}
      </span>
    </div>
  );
}
