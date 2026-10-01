// ─────────────────────────────────────────────────────────────
// RUCHI — no-guest contract (production transformation)
// ─────────────────────────────────────────────────────────────
// Guest mode has been REMOVED from RUCHI (production transformation):
// unauthenticated users see the welcome gate with sign-in/sign-up
// only. These tests encode the contract from both sides:
//
//  1. SOURCE — the store source no longer contains any guest machinery
//     (flag, action, persisted key, or flow state).
//  2. BEHAVIOR — a real module rehydrate with guest-era data in
//     localStorage must NOT revive guest mode: with no account the
//     flow resolves "unauthenticated" → welcome gate, and any history
//     is local-only until the user signs in.
//  3. SIGN-OUT — always lands on the welcome gate.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/lib/engine/analytics", () => ({ track: vi.fn() }));

const STORE_PATH = resolve(__dirname, "..", "index.ts");

// The guest-era data a user's localStorage may still hold (old shape is
// deliberately approximate — the real rehydrate must tolerate it).
const LEGACY_GUEST_STORE = {
  state: {
    name: "",
    history: [
      {
        id: "legacy-1",
        recipeId: "egg-maggi",
        recipeName: "Meal from the guest era",
        cookedAt: Date.now() - 60 * 60 * 1000,
        servings: 1,
        proteinG: 12,
        calories: 380,
        cost: 35,
        deliveryCompareCost: 90,
      },
    ],
    localOwner: null,
  },
  version: 1,
};

function installLegacyStorage(): void {
  const entries = Object.entries(LEGACY_GUEST_STORE.state);
  const storage: Record<string, string> = {
    "ruchi.store.v1": JSON.stringify(LEGACY_GUEST_STORE),
  };
  // Reference entries so the shim behaves like a real Storage impl.
  void entries;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
    clear: () => {
      for (const k of Object.keys(storage)) delete storage[k];
    },
  });
}

async function freshImport() {
  vi.resetModules();
  const mod = await import("../index");
  // The real boot step (as on a page load): attach the listener + settle
  // the initial session probe so authReady flips and the flow can resolve.
  mod.initAuthListener();
  await Promise.resolve();
  await Promise.resolve();
  return mod;
}

describe("no-guest contract", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    // Enough window surface for the store module's boot side effects:
    // the recovery-redirect probe reads location.search/hash, and the
    // auth listener attaches only in a browser-like environment.
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3000", search: "", hash: "", pathname: "/" },
      history: { replaceState: vi.fn() },
    });
    vi.stubGlobal("crypto", globalThis.crypto ?? { randomUUID: () => "t-1" });
    installLegacyStorage();
  });

  it("store source contains no guest machinery", () => {
    const src = readFileSync(STORE_PATH, "utf8");
    expect(src).not.toMatch(/guestMode/i);
    expect(src).not.toMatch(/enterGuestMode/i);
    expect(src).not.toMatch(/unauthenticated-guest/);
    expect(src).not.toMatch(/guest/i);
  });

  it("a legacy guest-era store does NOT revive guest mode — flow lands on the welcome gate", async () => {
    const { useRuchi, deriveAuthFlowState } = await freshImport();
    const s = useRuchi.getState();
    expect(s.authReady).toBe(true);
    expect(s.account).toBeNull();
    // The decisive assertion: "unauthenticated", never "unauthenticated-guest".
    expect(deriveAuthFlowState(s)).toBe("unauthenticated");
    expect("guestMode" in s).toBe(false);
  });

  it("sign-out clears any session state and the flow always resolves unauthenticated", async () => {
    const { useRuchi, deriveAuthFlowState } = await freshImport();
    useRuchi.getState().signOut();
    const s = useRuchi.getState();
    expect(s.account).toBeNull();
    expect(deriveAuthFlowState(s)).toBe("unauthenticated");
  });
});
