// ─────────────────────────────────────────────────────────────
// RUCHI — content rotation memory (personality engine, part 3/4)
// ─────────────────────────────────────────────────────────────
// Cross-session memory of what content has been shown, so repeat opens
// never read identically. Deliberately NOT part of the ruchi store:
// this is presentation state, not user data — it lives under its own
// localStorage key and is corrupt/absence-safe by construction.
//
// Session model: one "session" = one app open (page load). The counter
// advances exactly once per load; content shown in session N stays
// retired for the item's cooldown window (in sessions).

const STORAGE_KEY = "ruchi.content.v1";

/** How many recently-shown ids to remember per pool. */
const MEMORY_SPAN = 8;

interface MemoryEntry {
  id: string;
  /** Session number when this item was last shown. */
  session: number;
}

interface ContentMemory {
  session: number;
  recent: Record<string, MemoryEntry[]>;
}

let cached: ContentMemory | null = null;
let sessionBegun = false;

function emptyMemory(): ContentMemory {
  return { session: 0, recent: {} };
}

function readStorage(): ContentMemory {
  if (typeof window === "undefined") return emptyMemory();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMemory();
    const parsed = JSON.parse(raw) as ContentMemory | null;
    if (
      !parsed ||
      typeof parsed.session !== "number" ||
      !parsed.recent ||
      typeof parsed.recent !== "object"
    ) {
      return emptyMemory();
    }
    return parsed;
  } catch {
    return emptyMemory();
  }
}

function writeMemory(m: ContentMemory): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // Storage unavailable (private mode, quota) — rotation degrades to
    // in-page memory only. Never blocks the UI.
  }
}

function memory(): ContentMemory {
  if (!cached) cached = readStorage();
  return cached;
}

/** The current session number (advances once per page load). */
export function currentSession(): number {
  return memory().session;
}

/**
 * Start-of-open bookkeeping: advance the session counter. Idempotent per
 * page load (guarded), SSR-safe (no-op without a window).
 */
export function beginContentSession(): number {
  if (sessionBegun) return memory().session;
  sessionBegun = true;
  return advanceSession();
}

/**
 * Unconditionally advance the session counter and return the new one.
 * The engine's rotation clock — tests use it to simulate later opens;
 * production flows only ever use beginContentSession.
 */
export function advanceSession(): number {
  const m = memory();
  m.session = m.session + 1;
  writeMemory(m);
  return m.session;
}

/** Record that an item was shown this session (newest-first, span-capped). */
export function noteShown(pool: string, id: string, session: number): void {
  const m = memory();
  const list = m.recent[pool] ?? [];
  m.recent[pool] = [{ id, session }, ...list.filter((e) => e.id !== id)].slice(0, MEMORY_SPAN);
  writeMemory(m);
}

/** Recently-shown entries for a pool, newest first. */
export function recentShown(pool: string): MemoryEntry[] {
  return memory().recent[pool] ?? [];
}

/** Test hook: forget cached + persisted rotation memory. */
export function resetContentMemoryForTests(): void {
  cached = null;
  sessionBegun = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
