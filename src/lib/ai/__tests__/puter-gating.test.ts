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
    // SDK contract: signIn resolves once the (self-resolving temp-user or
    // interactive) popup handshake completes; token persistence is the
    // SDK's job — hence the isSignedIn toggle below.
    signIn: vi.fn(async () => undefined),
    isSignedIn: vi.fn(() => false),
    getUser: vi.fn(async (): Promise<{ username: string; is_temp?: boolean } | null> => null),
    signOut: vi.fn(),
  },
}));

vi.mock("@heyputer/puter.js", () => ({ puter: fakeClient }));

import {
  ensurePuterSession,
  loadPuter,
  puterChat,
  puterIsSignedIn,
  puterSdkReady,
  puterSdkState,
  resetPuterForTests,
  withPuterSdk,
} from "../puter";
import { PuterCookingAssistantService } from "../assistant";
import { PuterIngredientVisionService } from "../vision";
import { PuterMealRecommendationService } from "../recommendations";

beforeEach(() => {
  resetPuterForTests();
  vi.stubGlobal("window", {}); // node env: simulate browser presence
  // mockClear/reset clears CALLS but not implementations set below, so
  // every test starts from the fake's documented defaults.
  fakeClient.auth.isSignedIn.mockReset().mockReturnValue(false);
  fakeClient.auth.getUser.mockReset().mockResolvedValue(null);
  fakeClient.auth.signIn.mockReset().mockResolvedValue(undefined);
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
    // The ONLY auth call an explicit action may make is the official
    // temporary-user creation (no visible login/signup) — never a normal
    // interactive sign-in.
    expect(fakeClient.auth.signIn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_temp_user_creation: true }),
    );
  });

  it("Home's passive re-rank (rankRecommendations) never imports the SDK", async () => {
    // The exact call shape HomeScreen's mount effect sends. Pre-gating this
    // path imported the SDK on every page load → startup consent dialog.
    const recs = new PuterMealRecommendationService();
    const picks = await recs.rankRecommendations({
      availableIngredientIds: ["egg", "tomato"],
      intents: [],
      timeMaxMin: 0,
      budgetMaxInr: 0,
      servings: 2,
      diet: "non-vegetarian",
      skill: "beginner",
      candidates: [{ recipeId: "egg-bhurji", score: 1 }],
    });
    expect(picks).toBeNull(); // graceful deterministic fallback
    expect(puterSdkReady()).toBe(false);
    expect(puterSdkState().sdkImported).toBe(false);
    expect(fakeClient.ai.chat).not.toHaveBeenCalled();
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
  });  it("auth state reads are side-effect free", () => {
    expect(puterIsSignedIn()).toBe(false);
    expect(puterSdkState().sdkImported).toBe(false);
    expect(fakeClient.auth.signIn).not.toHaveBeenCalled();
  });
});

describe("temporary-user session (official no-login mechanism)", () => {
  it("creates a temporary user on demand — no manual signup required", async () => {
    // Default fake: no session → signIn resolves → temp identity created.
    fakeClient.auth.getUser.mockResolvedValue({ username: "user-x", is_temp: true });
    const session = await withPuterSdk(() => ensurePuterSession());
    expect(session).toEqual({
      ok: true,
      user: expect.objectContaining({ username: "user-x" }),
    });
    expect(fakeClient.auth.signIn).toHaveBeenCalledTimes(1);
    expect(fakeClient.auth.signIn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_temp_user_creation: true }),
    );
  });

  it("reuses an existing session without any auth call", async () => {
    fakeClient.auth.isSignedIn.mockReturnValue(true);
    fakeClient.auth.getUser.mockResolvedValue({ username: "returning-user", is_temp: false });
    const session = await withPuterSdk(() => ensurePuterSession());
    expect(session.ok).toBe(true);
    if (session.ok) expect(session.user.username).toBe("returning-user");
    expect(fakeClient.auth.signIn).not.toHaveBeenCalled();
  });

  it("failed temp-user creation reports honestly — never falls back to interactive login", async () => {
    fakeClient.auth.signIn.mockRejectedValue({ error: "popup_blocked" });
    const session = await withPuterSdk(() => ensurePuterSession());
    expect(session).toEqual({ ok: false, reason: "temp-user-failed" });
    // Exactly ONE attempt: no manual sign-in retry, no loop, no popup storm.
    expect(fakeClient.auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("vision analysis establishes the temp session automatically on explicit Analyze", async () => {
    fakeClient.auth.getUser.mockResolvedValue({ username: "user-x", is_temp: true });
    const vision = new PuterIngredientVisionService();
    const result = await vision.detectIngredients({
      imageDataUrl: "data:image/png;base64,x",
    });
    // Default fake chat returns non-JSON "ok" → invalid-json on both models
    // → null result. The point is the auth contract, not the payload.
    expect(result).toBeNull();
    expect(fakeClient.auth.signIn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_temp_user_creation: true }),
    );
  });

  it("an established session suppresses redundant temp-user attempts", async () => {
    fakeClient.auth.isSignedIn.mockReturnValue(true);
    fakeClient.auth.getUser.mockResolvedValue({ username: "user-x", is_temp: true });
    const vision = new PuterIngredientVisionService();
    await vision.detectIngredients({ imageDataUrl: "data:image/png;base64,x" });
    expect(fakeClient.auth.signIn).not.toHaveBeenCalled();
  });
});
