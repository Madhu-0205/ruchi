// ─────────────────────────────────────────────────────────────
// RUCHI — AI layer contracts (provider-agnostic)
// ─────────────────────────────────────────────────────────────
// The rest of the application depends ONLY on these types and the service
// factory in ./index.ts. Puter.js is the current implementation behind
// them (see puter.ts); swapping providers must not touch the app.

// ── Vision (IngredientVisionService) ────────────────────────

export interface VisionIngredient {
  /** Catalog id when confidently mapped to RUCHI's ingredient catalog. */
  catalogId?: string;
  /** Model label, e.g. "egg", "paneer". Display fallback when unmapped. */
  label: string;
  quantity?: string; // "4", "~200 g", "1 packet" — approximate human text
  confidence: number; // 0..1 label confidence
  quantityConfidence?: number; // 0..1
  uncertain: boolean; // must be confirmed by the user before cooking
}

export interface VisionAnalysis {
  ingredients: VisionIngredient[];
  /** Model-suggested look-alikes it could not confidently name. */
  uncertainItems: string[];
  notes: string[];
  modelUsed: string;
  elapsedMs: number;
}

export interface VisionRequest {
  /** Compressed, client-validated image as a data URL (jpeg/png/webp). */
  imageDataUrl: string;
  /** Optional free-text context, e.g. "I want something high protein". */
  userText?: string;
  /** AbortSignal so leaving the flow cancels the request. */
  signal?: AbortSignal;
}

export interface IngredientVisionService {
  /**
   * Photo + optional text → validated ingredients. Resolves null when the
   * AI layer is unavailable or failed — callers must fall back (never fake).
   */
  detectIngredients(req: VisionRequest): Promise<VisionAnalysis | null>;
  /** True when the underlying AI layer is usable right now. */
  isAvailable(): Promise<boolean>;
}

// ── Recommendations (MealRecommendationService) ─────────────

/**
 * AI's only lever over recommendations: select and order recipe ids from the
 * curated dataset, plus per-pick human "why" lines. The engine computes all
 * numbers (nutrition, cost, time); the AI never invents them.
 */
export interface RecommendationPick {
  recipeId: string;
  matchReason: string[];
}

export interface RecommendationContext {
  availableIngredientIds: string[];
  userText?: string;
  intents: string[]; // Intent ids: high-protein, quick, budget…
  timeMaxMin: number; // 0 = no limit
  budgetMaxInr: number; // 0 = no limit
  servings: number;
  diet: string;
  skill: string;
  /** Ranked candidates from the deterministic engine (recipeId + score). */
  candidates: { recipeId: string; score: number }[];
}

export interface MealRecommendationService {
  /**
   * Ordered subset of candidate recipeIds (3–4 when possible). Resolves
   * null when AI is unavailable — callers keep the deterministic ranking.
   */
  rankRecommendations(ctx: RecommendationContext): Promise<RecommendationPick[] | null>;
  isAvailable(): Promise<boolean>;
}

// ── Cooking assistant (CookingAssistantService) ─────────────

export interface CookingAssistantContext {
  recipeName: string;
  stepIndex: number;
  stepCount: number;
  stepTitle: string;
  stepText: string;
  heat?: string;
  durationMin?: number;
  lookFor: string;
  ingredients: string[]; // display names + quantities
  question: string;
}

export interface CookingAssistantReply {
  answer: string;
  tone: "reassure" | "instruct" | "rescue";
}

export interface CookingAssistantService {
  /** Resolves null when AI is unavailable — callers use curated help. */
  answer(ctx: CookingAssistantContext): Promise<CookingAssistantReply | null>;
  isAvailable(): Promise<boolean>;
}

// ── Shared ──────────────────────────────────────────────────

export type AiProviderName = "puter" | "none";

export type AiCapabilityKind = "vision" | "text";

/** Models this app may use, per capability (configured, not hard-coded). */
export interface AiModelConfig {
  provider: AiProviderName;
  visionModel: string;
  textModel: string;
}
