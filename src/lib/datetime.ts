// ─────────────────────────────────────────────────────────────
// RUCHI — local-calendar helpers (shared by store + data layer)
// ─────────────────────────────────────────────────────────────
// Small standalone module so the Supabase data layer and the zustand
// store can both use day keys without importing each other.

/** The product's home timezone: cron times, quiet hours and daily caps are IST. */
export const IST_OFFSET_MIN = 330;

/**
 * IST wall-clock hour for a timestamp — immune to the host machine's
 * timezone. Server code MUST use this instead of `Date#getHours()`,
 * which silently follows the runner's TZ (UTC in CI and on Vercel) and
 * would evaluate quiet hours against the wrong clock.
 */
export function istHourOf(now: number): number {
  return new Date(now + IST_OFFSET_MIN * 60_000).getUTCHours();
}

/** Local-calendar day key ("2026-09-16"), immune to locale/format drift. */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
