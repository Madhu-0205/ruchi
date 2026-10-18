// ─────────────────────────────────────────────────────────────
// RUCHI — deep-link read-once + URL cleanup
// ─────────────────────────────────────────────────────────────
// A tap on a notification is a one-time intent. These tests pin the two
// halves of that contract against a simulated browser:
//
//   1. Every deep-link param is applied at most once per page load.
//   2. Once applied, the params leave the address bar — so a reload (or a
//      re-open from history) starts clean and cannot replay the tap.
//
// They also cover the hand-off that makes `?category` reach its screen: the
// router consumes the param to decide the route, and Discover is only
// created by that route change, so the value travels in `routedCategory`.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Persist middleware (via the store the module imports) needs localStorage,
// and the module reads window.location / window.history.
const h = vi.hoisted(() => {
  const state = {
    href: "https://ruchi.test/",
    replaceStateCalls: [] as string[],
  };
  return { state };
});

vi.mock("@/lib/engine/analytics", () => ({ track: vi.fn() }));

vi.mock("@/lib/auth/supabase", () => ({ getSupabase: () => null }));

vi.mock("@/lib/auth/supabase-auth", () => ({
  completePasswordReset: async () => ({ status: "ok" }),
  consumeRecoveryRedirect: () => ({ recovery: false, email: null }),
  currentUser: async () => null,
  onAuthChange: () => null,
  requestPasswordReset: async () => ({ status: "sent" }),
  signIn: async () => null,
  signUp: async () => null,
  signOut: async () => {},
}));

vi.mock("@/lib/auth/supabase-data", () => ({
  fetchProfile: async () => ({ ok: true as const, data: null }),
  upsertProfile: async () => ({ ok: true as const, data: null }),
  fetchCompletedMeals: async () => ({ ok: true as const, data: [] }),
  insertCompletedMeals: async () => ({ ok: true as const, data: null }),
  recordStreakDay: async () => ({ ok: true as const, data: null }),
  recordCookingCompletion: async () => ({ ok: true as const, data: "recorded" as const }),
  fetchCookingStats: async () => ({ ok: true as const, data: null }),
  fetchRecentCookedMeals: async () => ({ ok: true as const, data: [] }),
  fetchNotificationPrefs: async () => ({ ok: true as const, data: null }),
  pushAttentionState: async () => ({ ok: true as const, data: null }),
  upsertNotificationChannels: async () => ({ ok: true as const, data: null }),
  upsertNotificationTypePrefs: async () => ({ ok: true as const, data: null }),
  markNotificationEngaged: async () => ({ ok: true as const, data: null }),
  pushKitchenMirror: async () => ({ ok: true as const, data: null }),
  pushPausedSession: async () => ({ ok: true as const, data: null }),
  pushLastAction: async () => ({ ok: true as const, data: null }),
}));

/**
 * Minimal browser surface: a location backed by one href, and a history whose
 * replaceState really moves the URL (so "reload" means re-reading the cleaned
 * href, not a stubbed string).
 */
function installBrowser(): void {
  const store = new Map<string, string>();
  const parsed = () => new URL(h.state.href);
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const win = {
    location: {
      get href() {
        return h.state.href;
      },
      get search() {
        return parsed().search;
      },
      get hash() {
        return parsed().hash;
      },
      get pathname() {
        return parsed().pathname;
      },
      get origin() {
        return parsed().origin;
      },
    },
    history: {
      replaceState: (_state: unknown, _title: string, url?: string) => {
        h.state.replaceStateCalls.push(url ?? "");
        if (typeof url === "string") {
          h.state.href = new URL(url, "https://ruchi.test").toString();
        }
      },
    },
    localStorage: storage,
    sessionStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.localStorage = storage;
  g.sessionStorage = storage;
}

/** Set the address bar (path + query + hash). */
function setUrl(path: string): void {
  h.state.href = `https://ruchi.test${path}`;
}

/** Load the module under test (and the router it drives) for this page load. */
async function loadPage() {
  const dl = await import("@/lib/notifications/deep-link");
  const { useScreen } = await import("@/lib/store/screens");
  return { dl, useScreen };
}

beforeEach(() => {
  vi.resetModules();
  h.state.href = "https://ruchi.test/";
  h.state.replaceStateCalls = [];
  installBrowser();
});

describe("deep-link read-once", () => {
  it("reads a param once per page load and never twice", async () => {
    setUrl("/?recipe=paneer-egg-bhurji");
    const { dl } = await loadPage();

    expect(dl.getPendingRecipe()).toBe("paneer-egg-bhurji");
    expect(dl.getPendingRecipe()).toBeNull();
    expect(dl.readOnce("recipe")).toBeNull();
  });

  it("applies a resume link, routes to cooking mode and cleans the URL", async () => {
    setUrl("/?resume=egg-maggi&n=ledger-1");
    const { dl, useScreen } = await loadPage();

    const target = dl.applyDeepLink();
    expect(target).toMatchObject({
      screen: "cooking",
      recipeId: "egg-maggi",
      ledgerId: "ledger-1",
      opened: false,
    });
    expect(useScreen.getState().screen).toBe("cooking");
    expect(useScreen.getState().recipeId).toBe("egg-maggi");

    // The params are gone from the address bar…
    expect(h.state.href).toBe("https://ruchi.test/");
    expect(h.state.replaceStateCalls).toHaveLength(1);
    // …and a second application in the same load does nothing at all.
    expect(dl.applyDeepLink()).toBeNull();
  });

  it("cannot replay the tap on reload, because the URL no longer carries it", async () => {
    setUrl("/?recipe=paneer-egg-bhurji");
    const first = await loadPage();
    expect(first.dl.applyDeepLink()?.recipeId).toBe("paneer-egg-bhurji");
    expect(h.state.href).toBe("https://ruchi.test/");
    const writes = h.state.replaceStateCalls.length;

    // Reload: fresh modules, same (already cleaned) address bar.
    vi.resetModules();
    const second = await loadPage();
    second.useScreen.setState({ screen: "home" });

    expect(second.dl.applyDeepLink()).toBeNull();
    expect(second.useScreen.getState().screen).toBe("home");
    expect(h.state.replaceStateCalls).toHaveLength(writes);
  });

  it("does not re-route when applyDeepLink is called again after the user moves", async () => {
    setUrl("/?recipe=paneer-egg-bhurji");
    const { dl, useScreen } = await loadPage();

    dl.applyDeepLink();
    expect(useScreen.getState().screen).toBe("meal");

    // The user navigates away, then the shell re-runs its effect (auth flow
    // transitions do this). The consumed intent must not fire again.
    useScreen.getState().go("home");
    expect(dl.applyDeepLink()).toBeNull();
    expect(useScreen.getState().screen).toBe("home");
  });

  it("does nothing, and touches no history, when there is no deep link", async () => {
    setUrl("/?utm_source=push");
    const { dl, useScreen } = await loadPage();

    expect(dl.applyDeepLink()).toBeNull();
    expect(dl.peekRoutedCategory()).toBeNull();
    expect(h.state.replaceStateCalls).toEqual([]);
    expect(useScreen.getState().screen).toBe("home");
  });
});

describe("deep-link category hand-off", () => {
  it("lands Discover on the category the notification promised", async () => {
    setUrl("/?category=high-protein");
    const { dl, useScreen } = await loadPage();

    const target = dl.applyDeepLink();
    expect(target).toMatchObject({ screen: "discover", categoryId: "high-protein" });
    expect(useScreen.getState().screen).toBe("discover");

    // The router consumed the param to decide the route; Discover (created by
    // that route change) still receives the promise, and reads it without
    // consuming so a re-render cannot lose it.
    expect(dl.peekRoutedCategory()).toBe("high-protein");
    expect(dl.peekRoutedCategory()).toBe("high-protein");
    expect(dl.getPendingCategory()).toBeNull();

    expect(h.state.href).toBe("https://ruchi.test/");
  });

  it("keeps unrelated params and the hash while stripping the deep-link ones", async () => {
    setUrl("/?category=mood-comfort&utm_source=push#top");
    const { dl } = await loadPage();

    dl.applyDeepLink();

    expect(h.state.href).toBe("https://ruchi.test/?utm_source=push#top");
    expect(dl.peekRoutedCategory()).toBe("mood-comfort");
  });

  it("routes to the higher-priority link and does not leak a stale category to Discover", async () => {
    // Priority order is resume → category → recipe, so the resume link wins.
    setUrl("/?resume=egg-maggi&category=high-protein");
    const { dl, useScreen } = await loadPage();

    const target = dl.applyDeepLink();
    expect(target).toMatchObject({ screen: "cooking", recipeId: "egg-maggi" });
    expect(useScreen.getState().screen).toBe("cooking");
    expect(h.state.href).toBe("https://ruchi.test/");

    // The superseded category must not wait in `routedCategory` for the next
    // time Discover mounts.
    expect(dl.peekRoutedCategory()).toBeNull();
  });
});
