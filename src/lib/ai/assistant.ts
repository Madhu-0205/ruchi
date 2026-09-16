// ─────────────────────────────────────────────────────────────
// RUCHI — CookingAssistantService (Puter implementation)
// ─────────────────────────────────────────────────────────────
// Contextual answers during Cooking Mode. The assistant receives the
// current recipe, step, heat, duration, look-for cue and ingredients, so
// answers are specific to this exact moment — never a generic chatbot.
// Falls back to the curated help library when Puter is unavailable.

"use client";

import { TEXT_MODEL_FALLBACKS, TEXT_TIMEOUT_MS } from "./config";
import { loadPuter, puterChat, messageOf } from "./puter";
import { ASSISTANT_SYSTEM_PROMPT, buildAssistantUserPrompt } from "./prompts";
import { parseAssistantReply } from "./schemas";
import { logAiEvent } from "./observability";
import type {
  CookingAssistantContext,
  CookingAssistantReply,
  CookingAssistantService,
} from "./types";

export class PuterCookingAssistantService implements CookingAssistantService {
  async isAvailable(): Promise<boolean> {
    return (await loadPuter()) !== null;
  }

  async answer(
    ctx: CookingAssistantContext,
  ): Promise<CookingAssistantReply | null> {
    logAiEvent("assistant_request", { step: ctx.stepIndex + 1 });

    const puter = await loadPuter();
    if (!puter) {
      logAiEvent("fallback_triggered", { stage: "assistant-sdk-unavailable" });
      return null;
    }

    const messages = [
      { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
      { role: "user", content: buildAssistantUserPrompt(ctx) },
    ];

    for (const model of TEXT_MODEL_FALLBACKS) {
      const raw = await puterChat(messages, {
        model,
        timeoutMs: TEXT_TIMEOUT_MS,
      });
      if (raw === null) {
        logAiEvent("assistant_failure", { model, reason: "no-response" });
        continue;
      }
      const parsed = parseAssistantReply(raw);
      if (!parsed) {
        logAiEvent("assistant_failure", { model, reason: "invalid-json" });
        continue;
      }
      logAiEvent("assistant_success", { model, tone: parsed.tone });
      return { answer: parsed.answer, tone: parsed.tone };
    }

    logAiEvent("fallback_triggered", { stage: "assistant-all-models-failed" });
    return null;
  }
}

export function assistantErrorMessage(err: unknown): string {
  return messageOf(err);
}
