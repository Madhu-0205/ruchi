// ─────────────────────────────────────────────────────────────
// RUCHI — deep-link bridge (Notification Experience 2.0, §10)
// ─────────────────────────────────────────────────────────────
// Pushes are short-lived: the only way a user learns about a
// notification is by tapping it, so the tap must land on the exact
// screen the message promised. This module reads the URL once on
// mount and translates params into the app's screen model:
//
//   ?recipe=<id>        → Meal Detail (the destination the engine
//                         computed a recommendation for)
//   ?resume=<id>        → Cooking Mode at the saved step
//   ?category=<id>      → Discover with that category open
//   ?n=<ledgerId>       → also lets the app record "opened" against
//                         that ledger row (client → RPC, own-row RLS)
//
// After handling, the browser history is cleaned so a refresh never
// re-triggers the same intent. Cleanup happens HERE, at the consumer,
// because removing a param before its reader has seen it would silence
// the notification the user just tapped.
//
// One param cannot travel by URL alone: `?category` has to reach Discover,
// and Discover is *created* by the route change applyDeepLink performs — by
// then the param has been consumed. The router therefore passes the value
// through `routedCategory` (see `peekRoutedCategory`).
import { useScreen } from "@/lib/store/screens";
import { track } from "@/lib/engine/analytics";
import { useRuchi } from "@/lib/store";
import { markNotificationEngaged } from "@/lib/auth/supabase-data";

// One-shot reads, keyed by param name — the URL is consumed exactly
// once per page load (never read twice, never re-triggered on
// navigation).
const READ_ONCE = new Set<string>();

export interface DeepLinkTarget {
  screen: "meal" | "cooking" | "discover";
  recipeId?: string;
  categoryId?: string;
  ledgerId?: string;
  opened: boolean;
  actioned: boolean;
}

const MEMORY_KEY = "ruchi.deeplink";

/** Read a single query param once per session (and remember it). */
export function readOnce(param: string): string | null {
  if (READ_ONCE.has(param)) return null;
  READ_ONCE.add(param);
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(param);
  if (value) {
    try {
      sessionStorage.setItem(MEMORY_KEY, JSON.stringify({ param, value }));
    } catch {
      // storage full / private mode — deep link still works, analytics
      // simply cannot be recorded.
    }
  }
  return value;
}

/**
 * The category this deep link promised Discover, for the screen that mounts
 * next. Set by `applyDeepLink` when a category is the winning target, and read
 * (never consumed) by Discover's initial state — so the promise survives the
 * navigation that creates the screen. `null` when the link promised no
 * category, or promised one that a higher-priority link superseded.
 */
let routedCategory: string | null = null;

export function peekRoutedCategory(): string | null {
  return routedCategory;
}

export function getPendingCategory(): string | null {
  const raw = readOnce("category");
  if (!raw) return null;
  return raw.startsWith("?") ? raw.slice(1) : raw;
}

export function getPendingResume(): string | null {
  return readOnce("resume");
}

export function getPendingRecipe(): string | null {
  return readOnce("recipe");
}

/** Every query param this module translates into app state. */
const DEEP_LINK_PARAMS = ["category", "resume", "recipe", "n"] as const;

/**
 * Strip the deep-link params from the address bar once their intent has been
 * applied, so a refresh, a re-open from history or a shared link starts clean
 * instead of replaying a notification that was already delivered. The path,
 * the hash and any unrelated params are preserved.
 *
 * Best-effort by design: if the History API is unavailable the in-memory
 * one-shot gates still stop a second application within this page load.
 */
export function clearDeepLinkParams(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let touched = false;
    for (const param of DEEP_LINK_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        touched = true;
      }
    }
    if (!touched) return;
    const query = url.searchParams.toString();
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${query ? `?${query}` : ""}${url.hash}`,
    );
  } catch {
    // History API unavailable: nothing to clean, and nothing re-applies
    // either.
  }
}

/** Applied exactly once per load — safe to call on every page. */
export function applyDeepLink(): DeepLinkTarget | null {
  if (typeof window === "undefined") return null;
  const category = getPendingCategory();
  const resume = getPendingResume();
  const recipe = getPendingRecipe();
  const ledgerId = readOnce("n");

  if (!category && !resume && !recipe && !ledgerId) return null;

  let target: DeepLinkTarget | null = null;

  if (resume) {
    target = {
      screen: "cooking",
      recipeId: resume,
      opened: false,
      actioned: false,
      ledgerId: ledgerId ?? undefined,
    };
    useScreen.getState().go("cooking", { recipeId: resume });
  } else if (category) {
    target = {
      screen: "discover",
      categoryId: category,
      opened: false,
      actioned: false,
      ledgerId: ledgerId ?? undefined,
    };
    // The category only reaches Discover through this hand-off: the param is
    // consumed here, and the screen is created by the route change below.
    // A superseded category (a recipe/resume link won) deliberately does NOT
    // set it, so a later visit to Discover in this load cannot inherit a
    // stale promise.
    routedCategory = category;
    useScreen.getState().go("discover");
  } else if (recipe) {
    target = {
      screen: "meal",
      recipeId: recipe,
      opened: false,
      actioned: false,
      ledgerId: ledgerId ?? undefined,
    };
    useScreen.getState().go("meal", { recipeId: recipe });
  }

  // The params have now been read (and their intent applied), so the URL can
  // stop advertising them — a reload must not replay this tap.
  clearDeepLinkParams();

  // record "opened" server-side (own-row, RLS-guarded RPC).
  if (ledgerId) {
    void (async () => {
      const supabase = (await import("@/lib/auth/supabase")).getSupabase();
      if (!supabase || !useRuchi.getState().account) return;
      const res = await markNotificationEngaged(ledgerId, false);
      if (!res.ok) return;
      track("notification_opened", {
        opportunity_type: "notification",
        ledger_id: ledgerId,
      });
    })();
  }

  return target;
}

/** Call when the user begins cooking from a deep-link landing. */
export function markDeepLinkActioned(ledgerId: string | null): void {
  if (!ledgerId) return;
  if (typeof window === "undefined") return;
  const stored = sessionStorage.getItem(MEMORY_KEY);
  // Only act when the *deep-link* intent is fresh (not a normal UI).
  if (!stored) return;
  if (stored.includes("resume") || stored.includes("recipe=") || stored.includes("category=")) {
    void (async () => {
      const supabase = (await import("@/lib/auth/supabase")).getSupabase();
      if (supabase) {
        await markNotificationEngaged(ledgerId, true);
      }
    })();
  }
}
