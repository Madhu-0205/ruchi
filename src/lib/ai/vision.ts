// ─────────────────────────────────────────────────────────────
// RUCHI — IngredientVisionService (Puter implementation)
// ─────────────────────────────────────────────────────────────
// One photo + optional user text → validated structured ingredients.
// All output is schema-validated before it leaves this module; malformed
// or failed responses return null and the UI shows its text fallback —
// never a faked result.

"use client";

import { VISION_MODEL_FALLBACKS, VISION_TIMEOUT_MS } from "./config";
import { loadPuter, puterChat, modelSupportsVision, messageOf } from "./puter";
import {
  buildVisionSystemPrompt,
  buildVisionUserPrompt,
  VISION_CATALOG,
} from "./prompts";
import { parseVisionAnalysis, type VisionAnalysisPayload } from "./schemas";
import { logAiEvent } from "./observability";
import type {
  IngredientVisionService,
  VisionAnalysis,
  VisionIngredient,
  VisionRequest,
} from "./types";

/** Confidence below which an unmapped label is treated as a guess. */
const CONFIDENT_THRESHOLD = 0.55;

export class PuterIngredientVisionService implements IngredientVisionService {
  async isAvailable(): Promise<boolean> {
    return (await loadPuter()) !== null;
  }

  async detectIngredients(req: VisionRequest): Promise<VisionAnalysis | null> {
    const started = Date.now();
    logAiEvent("vision_request_started", { hasText: Boolean(req.userText) });

    const puter = await loadPuter();
    if (!puter) {
      logAiEvent("fallback_triggered", { stage: "vision-sdk-unavailable" });
      return null;
    }

    const messages = [
      { role: "system", content: buildVisionSystemPrompt() },
      {
        role: "user",
        content: [
          { type: "text", text: buildVisionUserPrompt(req.userText) },
          { type: "image_url", image_url: { url: req.imageDataUrl } },
        ],
      },
    ];

    // Configured model first; catalog-checked fallbacks after.
    const [primary, ...fallbacks] = VISION_MODEL_FALLBACKS;
    for (const model of [primary, ...fallbacks]) {
      if (model !== primary && !(await modelSupportsVision(model))) continue;

      const raw = await puterChat(messages, {
        model,
        timeoutMs: VISION_TIMEOUT_MS,
        signal: req.signal,
      });
      if (raw === null) {
        logAiEvent("vision_failure", { reason: "no-response", model });
        continue; // auth dismissed, timeout, model error → next candidate
      }

      const parsed = parseVisionAnalysis(raw);
      if (!parsed) {
        logAiEvent("vision_failure", { reason: "invalid-json", model });
        continue; // try the next model before giving up
      }

      const result = toVisionAnalysis(parsed, model, Date.now() - started);
      logAiEvent("vision_success", {
        model,
        ingredients: result.ingredients.length,
        uncertain: result.uncertainItems.length,
        ms: result.elapsedMs,
      });
      return result;
    }

    logAiEvent("fallback_triggered", { stage: "vision-all-models-failed" });
    return null;
  }
}

/**
 * Map a validated payload onto catalog ids. Items the model invented ids
 * for are demoted to uncertain guesses; unknown labels below the
 * confidence threshold are dropped (anti-hallucination), and explicit
 * uncertain_items become confirmable rows instead of lost text.
 */
export function toVisionAnalysis(
  parsed: VisionAnalysisPayload,
  model: string,
  elapsedMs: number,
): VisionAnalysis {
  const allowed = new Set<string>(VISION_CATALOG);
  const ingredients: VisionIngredient[] = [];
  const seen = new Set<string>();

  for (const it of parsed.ingredients) {
    const id = it.id && allowed.has(it.id) ? it.id : undefined;
    if (!id && it.confidence < CONFIDENT_THRESHOLD) continue;
    const key = id ?? it.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ingredients.push({
      catalogId: id,
      label: it.name,
      quantity: it.quantity,
      confidence: Math.round(it.confidence * 100) / 100,
      quantityConfidence: it.quantity_confidence,
      uncertain: !id || it.confidence < CONFIDENT_THRESHOLD,
    });
  }

  for (const raw of parsed.uncertain_items) {
    if (ingredients.length >= 12) break;
    if (ingredients.some((i) => i.label.toLowerCase() === raw.toLowerCase())) continue;
    ingredients.push({ label: raw, confidence: 0.3, uncertain: true });
  }

  return { ingredients, uncertainItems: parsed.uncertain_items, notes: parsed.notes, modelUsed: model, elapsedMs };
}

export function visionErrorMessage(err: unknown): string {
  return messageOf(err);
}
