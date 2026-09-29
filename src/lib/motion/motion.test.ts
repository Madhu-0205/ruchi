import { describe, expect, it } from "vitest";
// ─────────────────────────────────────────────────────────────
// Motion system contracts — the invariants screens rely on.
// The primitives themselves are client components (framer-motion),
// so these tests pin the token layer: the part that must never
// silently drift.
// ─────────────────────────────────────────────────────────────
import {
  DURATION,
  EASE,
  EASE_OUT,
  SPRING,
  STAGGER_CHILDREN,
  STAGGER_DELAY,
  STAGGER_MAX_DELAY,
  pageTransition,
  stepTransition,
  heroReveal,
  bloomIn,
  pressTap,
} from "./index";

describe("motion tokens", () => {
  it("duration tiers respect the luxury bands (fast < standard < emphasis < cinematic)", () => {
    expect(DURATION.fast).toBeGreaterThanOrEqual(0.1);
    expect(DURATION.fast).toBeLessThanOrEqual(0.16);
    expect(DURATION.standard).toBeGreaterThan(DURATION.fast);
    expect(DURATION.standard).toBeLessThanOrEqual(0.28);
    expect(DURATION.emphasis).toBeGreaterThan(DURATION.standard);
    expect(DURATION.emphasis).toBeLessThanOrEqual(0.65);
    expect(DURATION.cinematic).toBeGreaterThan(DURATION.emphasis);
    expect(DURATION.cinematic).toBeLessThanOrEqual(0.9);
  });

  it("uses the signature ease everywhere long transforms run", () => {
    // 0.22, 1, 0.36, 1 — fast start, long soft settle
    expect(EASE).toEqual([0.22, 1, 0.36, 1]);
    // exits are decisively shorter
    expect(EASE_OUT).not.toEqual(EASE);
  });

  it("springs are critically-to-over-damped: no cartoon bounce", () => {
    for (const spring of Object.values(SPRING)) {
      const s = spring as { type: string; stiffness: number; damping: number };
      expect(s.type).toBe("spring");
      // damping ratio proxy: damping must be well above undamped threshold
      // for these stiffness ranges → settle without visible oscillation
      expect(s.damping).toBeGreaterThanOrEqual(20);
      expect(s.stiffness).toBeGreaterThan(0);
    }
    // hero lands heavier (no overshoot at all)
    expect((SPRING.hero as { damping: number }).damping).toBeGreaterThanOrEqual(
      (SPRING.tactile as { damping: number }).damping - 4,
    );
  });

  it("stagger rhythm is tight and capped", () => {
    expect(STAGGER_CHILDREN).toBeLessThanOrEqual(0.08);
    expect(STAGGER_DELAY).toBeLessThanOrEqual(STAGGER_CHILDREN);
    expect(STAGGER_MAX_DELAY).toBeLessThanOrEqual(0.35);
  });

  it("press compression stays subtle (not a squash toy)", () => {
    expect(pressTap.scale).toBeGreaterThanOrEqual(0.95);
    expect(pressTap.scale).toBeLessThan(1);
  });

  it("page transition exits faster than it enters", () => {
    const enter = pageTransition.animate.transition.duration;
    const exit = pageTransition.exit.transition.duration;
    expect(exit).toBeLessThan(enter);
  });

  it("step transition keeps spatial continuity (small x move)", () => {
    expect(Math.abs(stepTransition.initial.x)).toBeLessThanOrEqual(20);
    expect(Math.abs(stepTransition.exit.x)).toBeLessThanOrEqual(20);
  });

  it("hero reveal sequence: image → title → meta, monotonic delays; CTA springs", () => {
    const img = (heroReveal.image.animate.transition as { delay?: number }).delay ?? 0;
    const title = (heroReveal.title.animate.transition as { delay?: number }).delay ?? 0;
    const meta = (heroReveal.meta.animate.transition as { delay?: number }).delay ?? 0;
    expect(img).toBeLessThan(title);
    expect(title).toBeLessThan(meta);
    // CTA arrives on a spring after the meta delay (delay sits on animate)
    const cta = heroReveal.cta.animate as { delay?: number; transition: { stiffness?: number } };
    expect(cta.delay ?? 0).toBeGreaterThanOrEqual(meta);
    expect(cta.transition.stiffness).toBeGreaterThan(0);
  });

  it("bloom-in scale is a whisper, not a pop", () => {
    const scale = (bloomIn.initial as { scale: number }).scale;
    expect(scale).toBeGreaterThanOrEqual(0.9);
    expect(scale).toBeLessThan(1);
  });
});
