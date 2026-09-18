// ─────────────────────────────────────────────────────────────
// RUCHI — local-calendar helpers (shared by store + data layer)
// ─────────────────────────────────────────────────────────────
// Small standalone module so the Supabase data layer and the zustand
// store can both use day keys without importing each other.

/** Local-calendar day key ("2026-09-16"), immune to locale/format drift. */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
