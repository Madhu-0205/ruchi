// ─────────────────────────────────────────────────────────────
// RUCHI — content selection engine (personality engine, part 4/4)
// ─────────────────────────────────────────────────────────────
// Deterministic, context-aware, rotation-safe content picking.
// Determinism: same (context, session, pool) → same pick — SSR and
// hydration always agree, and a given visit reads the same on re-check,
// while DIFFERENT sessions rotate through the pool.
//
// Selection = filter by context/tone → rank by eligibility → stable
// deterministic ordering → first eligible. Eligibility means: never
// the immediately-previous session's pick, and within the item's
// cooldown window nothing newer may be chosen.
// ─────────────────────────────────────────────────────────────

import { POOLS, type PoolName } from "./pools";
import { currentSession, noteShown, recentShown } from "./memory";
import type { ContentContext, ContentPick, RuchiContentItem } from "./types";

/** Deterministic 32-bit hash — stable across sessions and reloads. */
export function hashOf(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Is the item active, and is `hour` inside its time window (if any)? */
function isActiveAt(item: RuchiContentItem, hour: number): boolean {
  if (item.active === false) return false;
  if (!item.hours) return true;
  const [start, end] = item.hours;
  // Window may wrap midnight (e.g. [22, 24] and [0, 5] are both used).
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Would showing this item repeat recent memory? Returns true when the
 * item is eligible: either never shown, shown THIS session (a re-render
 * must re-display the same line), or its cooldown window (in sessions)
 * has fully elapsed since a previous session's showing.
 */
function isCooled(item: RuchiContentItem, session: number, pool: string): boolean {
  const cooldown = item.cooldown ?? 4;
  const shown = recentShown(pool).find((e) => e.id === item.id);
  if (!shown) return true;
  return shown.session === session || session - shown.session >= cooldown;
}

/**
 * Deterministic display order for a pool at a given session:
 * priority first (time-windowed lines outrank evergreens inside their
 * window), then the hash of (pool, item id, session) so equal-priority
 * items rotate in a different-but-stable order each session.
 */
function varietyOrder(items: RuchiContentItem[], pool: string, session: number): RuchiContentItem[] {
  return [...items].sort((a, b) => {
    const pa = a.priority ?? 5;
    const pb = b.priority ?? 5;
    if (pa !== pb) return pb - pa;
    const ha = hashOf(`${pool}:${a.id}:${session}`);
    const hb = hashOf(`${pool}:${b.id}:${session}`);
    return ha - hb || a.id.localeCompare(b.id);
  });
}

/**
 * Pick one item from a pool. Deterministic given (pool, context,
 * session, memory). Context gating is a HARD filter — a first-time
 * user is never shown a returning-user line and vice versa (real-data
 * rule): when the context excludes every item, this returns null and
 * the caller falls back to its own static copy. Tone and time-window
 * exhaustion relax gracefully; cooldown exhaustion picks the least-
 * recently-shown eligible item rather than repeating.
 */
export function pickContent(
  pool: PoolName,
  ctx: ContentContext,
  tone?: RuchiContentItem["tone"],
): ContentPick | null {
  const items = POOLS[pool];
  const session = currentSession();

  // Greetings rotate for everyone; contextual pools honor real state.
  const contextOk = (item: RuchiContentItem): boolean => {
    switch (item.category) {
      case "FIRST_TIME_USER":
        return ctx.isFirstTime;
      case "RETURNING_USER":
        return !ctx.isFirstTime;
      case "COOK_AGAIN":
        return ctx.hasCookAgain;
      default:
        return true;
    }
  };

  // Hard gate: context first. Nothing may bypass it.
  const contextPassing = items.filter(contextOk);
  if (contextPassing.length === 0) return null;

  const byTone = tone ? contextPassing.filter((i) => i.tone === tone) : contextPassing;
  const base = byTone.length > 0 ? byTone : contextPassing;
  const candidates = base.filter((i) => isActiveAt(i, ctx.hour));
  // Time window exhaustion (e.g. a tone with only morning lines at
  // midnight) relaxes to the tone-passing set rather than fabricating.
  const timeUsable = candidates.length > 0 ? candidates : base;
  const eligible = timeUsable.filter((i) => isCooled(i, session, pool));
  const usable = eligible.length > 0 ? eligible : timeUsable;
  const ordered = varietyOrder(usable, pool, session);
  const best = ordered[0]!;
  return { item: best, pool };
}

/**
 * Pick AND remember. The UI-facing API — calling this twice in the
 * same session yields the same line (determinism), a later session
 * sees a different line (rotation), and the item then cools down.
 * Null (context-excluded pool) is passed through untouched.
 */
export function pickAndNote(
  pool: PoolName,
  ctx: ContentContext,
  tone?: RuchiContentItem["tone"],
): ContentPick | null {
  const pick = pickContent(pool, ctx, tone);
  if (!pick) return null;
  noteShown(pool, pick.item.id, currentSession());
  return pick;
}

/** Convenience for pure display when memory writes aren't wanted. */
export { pickContent as pick };
