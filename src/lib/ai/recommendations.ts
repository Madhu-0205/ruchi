// ─────────────────────────────────────────────────────────────
// RUCHI — MealRecommendationService (AI re-rank over curated data)
// ─────────────────────────────────────────────────────────────
// The deterministic engine (lib/engine) proposes ranked candidates from the
// curated recipe dataset; this service lets the AI select and order the
// final 3–4 and write the human "why" lines. The AI may ONLY pick recipe
// ids from the candidate list — it can never invent recipes. Nutrition,
// cost, time and servings stay computed by the app, never by the model.

"use client";

import { TEXT_MODEL_FALLBACKS, TEXT_TIMEOUT_MS } from "./config";
import { loadPuter, puterChat, messageOf } from "./puter";
import {
  buildRecommendationSystemPrompt,
  buildRecommendationUserPrompt,
} from "./prompts";
import { parseRecommendationPicks } from "./schemas";
import { logAiEvent } from "./observability";
import type {
  MealRecommendationService,
  RecommendationContext,
  RecommendationPick,
} from "./types";

export class PuterMealRecommendationService implements MealRecommendationService {
  async isAvailable(): Promise<boolean> {
    return (await loadPuter()) !== null;
  }

  async rankRecommendations(
    ctx: RecommendationContext,
  ): Promise<RecommendationPick[] | null> {
    if (ctx.candidates.length === 0) return null;
    logAiEvent("recommendation_request", {
      candidates: ctx.candidates.length,
      intents: ctx.intents.join("|"),
    });

    const puter = await loadPuter();
    if (!puter) {
      logAiEvent("fallback_triggered", { stage: "recommendation-sdk-unavailable" });
      return null;
    }

    const messages = [
      { role: "system", content: buildRecommendationSystemPrompt() },
      { role: "user", content: buildRecommendationUserPrompt(ctx) },
    ];

    const validIds = new Set(ctx.candidates.map((c) => c.recipeId));

    for (const model of TEXT_MODEL_FALLBACKS) {
      const raw = await puterChat(messages, {
        model,
        timeoutMs: TEXT_TIMEOUT_MS,
      });
      if (raw === null) {
        logAiEvent("recommendation_failure", { model, reason: "no-response" });
        continue;
      }

      const parsed = parseRecommendationPicks(raw);
      if (!parsed) {
        logAiEvent("recommendation_validation_failed", { model });
        continue;
      }

      // Enforce the candidate fence: drop invented ids and dedupe.
      const picks: RecommendationPick[] = [];
      const seen = new Set<string>();
      for (const p of parsed.picks) {
        if (!validIds.has(p.recipeId) || seen.has(p.recipeId)) continue;
        seen.add(p.recipeId);
        picks.push({ recipeId: p.recipeId, matchReason: p.matchReason });
      }
      if (picks.length === 0) {
        logAiEvent("recommendation_validation_failed", { model, reason: "no-valid-ids" });
        continue;
      }

      logAiEvent("recommendation_success", { model, picks: picks.length });
      return picks;
    }

    logAiEvent("fallback_triggered", { stage: "recommendation-all-models-failed" });
    return null;
  }
}

export function recommendationErrorMessage(err: unknown): string {
  return messageOf(err);
}
