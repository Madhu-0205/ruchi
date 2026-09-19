// ─────────────────────────────────────────────────────────────
// RUCHI — Puter SDK gating tests (regression guards)
// ─────────────────────────────────────────────────────────────
// Puter's SDK starts its consent/temp-user flow the moment it is
// EVALUATED, so any passive loadPuter() equals a surprise authorization
// prompt. These tests prove:
//   • startup-shaped passive loads never import the SDK
//   • availability probes never import the SDK
//   • Supabase-independent account paths never touch Puter here
//   • only explicit AI wrappers (withPuterSdk) may import it
//   • after an explicit load, passive paths reuse the cached client
//     without re-triggering anything

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeClient = vi.hoisted(() => ({
  ai: {
    chat: vi.fn(async () => ({ message: { content: "ok" } })),
    listModels: vi.fn(async () => []),
  },
  auth: {
    signIn: vi.fn(async () => undefined),
    isSignedIn: vi.fn(() => false),
    getUser: vi.fn(async () => null),
    signOut: vi.fn(),
  },
}));

vi.mock("@heyputer/puter.js", () => ({ puter: fakeClient }));

import {
  loadPuter,
  puterChat,
  puterIsSignedIn,
  puterSdkReady,
  puterSdkState,
  resetPuterForTests,
} from "../puter";
import { PuterCookingAssistantService } from "../assistant";
import { PuterMealRecommendationService } from "../recommendations";

beforeEach(() => {
  resetPuterForTests();
  vi.stubGlobal("window", {}); // node env: simulate browser presence
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Puter SDK gating (no passive authorization)", () => {
  it("startup-shaped passive load never imports the SDK", async () => {
    // Mirrors app mount: any module asking for the bridge without an
    // explicit AI action in flight must get null, silently.
    expect(await loadPuter()).toBeNull();
    expect(puterSdkReady()).toBe(false);
    expect(puterSdkState().sdkImported).toBe(false);
    expect(puterSdkState().firstAccess?.stage).toBe("blocked-passive-load");
    expect(fakeClient.auth.signIn).not.toHaveBeenCalled();
  });

  it("service availability probes never import the SDK", async () => {
    const recs = new PuterMealRecommendationService();
    const asst = new PuterCookingAssistantService();
    // Passive probes are the pre-gating behavior that caused the startup
    // consent dialog — they must be inert now.
    expect(await recs.isAvailable()).toBe(false);
    expect(await asst.isAvailable()).toBe(false);
    expect(puterSdkState().sdkImported).toBe(false);
    expect(fakeClient.auth.signIn).not.toHaveBeenCalled();
  });

  it("an explicit AI action may import the SDK, and then every path reuses it", async () => {
    const asst = new PuterCookingAssistantService();
    // Explicit user intent (cooking help) → gate opens → SDK loads. The
    // answer itself may still fail validation — the point is that this is
    // the ONLY context in which the SDK is allowed to be imported.
    await asst.answer({
      recipeName: "Egg Bhurji",
      stepIndex: 0,
      stepCount: 3,
      stepTitle: "Soften the onions",
      stepText: "Add onions and cook until soft.",
      lookFor: "Translucent, lightly golden",
      ingredients: ["eggs × 4", "onion × 1"],
      question: "How do I know they're ready?",
    });
    expect(puterSdkReady()).toBe(true);
    expect(puterSdkState().firstAccess?.stage).toBe("sdk-import");
    // After an established client, even passive callers reuse it — nothing
    // re-prompts, nothing re-imports.
    expect(await loadPuter()).toBe(fakeClient);
    expect(fakeClient.auth.signIn).not.toHaveBeenCalled();
  });

  it("puterChat from a passive context stays inert and fails soft", async () => {
    const res = await puterChat([{ role: "user", content: "hi" }], {
      model: "test-model",
      timeoutMs: 50,
    });
    expect(res).toBeNull();
    expect(fakeClient.ai.chat).not.toHaveBeenCalled();
    expect(puterSdkState().sdkImported).toBe(false);
  });

  it("auth state reads are side-effect free", () => {
    expect(puterIsSignedIn()).toBe(false);
    expect(puterSdkState().sdkImported).toBe(false);
    expect(fakeClient.auth.signIn).not.toHaveBeenCalled();
  });
});
