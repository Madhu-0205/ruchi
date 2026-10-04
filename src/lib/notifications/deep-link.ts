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
// re-triggers the same intent.

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
