// ─────────────────────────────────────────────────────────────
// RUCHI — AI layer public surface
// ─────────────────────────────────────────────────────────────
// The app imports AI ONLY from here. Puter is the implementation behind
// these interfaces; swapping providers means rewriting this folder, not
// the product. Without Puter everything falls back deterministically.

"use client";

import { PuterIngredientVisionService } from "./vision";
import { PuterMealRecommendationService } from "./recommendations";
import { PuterCookingAssistantService } from "./assistant";
import { AI_PROVIDER, modelConfig } from "./config";
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
  AiModelConfig,
  AiProviderName,
} from "./types";

export { prepareImageForVision, ACCEPTED_IMAGE_TYPES } from "./image";
export type { ImagePrepResult } from "./image";
export { resetPuterForTests } from "./puter";

// ── Service singletons (client-side) ────────────────────────

let visionService: IngredientVisionService | null = null;
let recommendationService: MealRecommendationService | null = null;
let assistantService: CookingAssistantService | null = null;

export function getVisionService(): IngredientVisionService {
  if (!visionService) visionService = new PuterIngredientVisionService();
  return visionService;
}

export function getRecommendationService(): MealRecommendationService {
  if (!recommendationService) {
    recommendationService = new PuterMealRecommendationService();
  }
  return recommendationService;
}

export function getAssistantService(): CookingAssistantService {
  if (!assistantService) assistantService = new PuterCookingAssistantService();
  return assistantService;
}

/** True when the configured provider is puter (i.e. AI paths may work). */
export function aiConfigured(): boolean {
  return AI_PROVIDER === "puter";
}

export { modelConfig };
