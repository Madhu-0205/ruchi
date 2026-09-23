// ─────────────────────────────────────────────────────────────
// RUCHI — AI layer public surface
// ─────────────────────────────────────────────────────────────
// The app imports AI ONLY from here. Vision is a server-backed Gemini call
// (/api/analyze-ingredients) with no client-side keys; recommendation
// ranking and the cooking assistant are deterministic-only today and keep
// their provider-agnostic contracts (they resolve null → curated fallbacks)
// so a backend can be added later without touching feature code.

"use client";

import { GeminiIngredientVisionService } from "./vision";
import { visionDebug, recordVisionFallback } from "./observability";
import type {
  IngredientVisionService,
  MealRecommendationService,
  CookingAssistantService,
} from "./types";

export type {
  IngredientVisionService,
  MealRecommendationService,
  CookingAssistantService,
  VisionRequest,
  VisionAnalysis,
  VisionIngredient,
  RecommendationContext,
  RecommendationPick,
  CookingAssistantContext,
  CookingAssistantReply,
} from "./types";

export { prepareImageForVision, ACCEPTED_IMAGE_TYPES } from "./image";
export type { ImagePrepResult } from "./image";

// ── Service singletons (client-side) ────────────────────────

let visionService: IngredientVisionService | null = null;

/**
 * Vision: Gemini via the server route. On any failure (server unconfigured,
 * network error, nothing detected) the chain stops and the caller shows the
 * premium manual "I have…" flow. No popup, no client keys, no masking.
 */
export function getVisionService(): IngredientVisionService {
  if (!visionService) {
    const gemini = new GeminiIngredientVisionService();
    visionService = {
      isAvailable: async () => gemini.isAvailable(),
      detectIngredients: async (req) => {
        visionDebug("stage=gemini-start");
        const result = await gemini.detectIngredients(req);
        if (result && result.ingredients.length > 0) {
          visionDebug("stage=gemini-success", { accepted: result.ingredients.length });
          return result;
        }
        recordVisionFallback(result ? "no-ingredients-detected" : "gemini-unavailable");
        return result;
      },
    };
  }
  return visionService;
}

/**
 * Deterministic-only re-rank stub. The contract stays provider-agnostic;
 * today there is no server re-ranking backend, so this always yields null
 * and Home renders the deterministic engine's ranking (source of truth).
 */
class DeterministicMealRecommendationService implements MealRecommendationService {
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async rankRecommendations(): Promise<null> {
    return null;
  }
}

/** Deterministic-only cooking help. Cooking Mode uses its curated answers. */
class DeterministicCookingAssistantService implements CookingAssistantService {
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async answer(): Promise<null> {
    return null;
  }
}

let recommendationService: MealRecommendationService | null = null;
let assistantService: CookingAssistantService | null = null;

export function getRecommendationService(): MealRecommendationService {
  if (!recommendationService) {
    recommendationService = new DeterministicMealRecommendationService();
  }
  return recommendationService;
}

export function getAssistantService(): CookingAssistantService {
  if (!assistantService) assistantService = new DeterministicCookingAssistantService();
  return assistantService;
}

/**
 * Kept for existing call sites: AI assistance is available only when a
 * backend is configured. With the deterministic-only services above this is
 * always false today — call sites fall back to curated content.
 */
export function aiConfigured(): boolean {
  return false;
}
