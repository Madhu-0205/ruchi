import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// RUCHI — AI payload contracts (Zod)
// ─────────────────────────────────────────────────────────────
// Every AI response is UNTRUSTED external data: parsed and validated here
// before anything reaches the UI or the store. Malformed payloads are
// normalized once (jsonObject) and then either validated or rejected.

/**
 * Models answer with JSON even when asked for "only JSON": code fences,
 * leading prose, trailing commentary. This normalizes that once. If the
 * first `{` to last `}` slice still isn't JSON, safeParse fails and the
 * caller falls back — the app never crashes on a malformed payload.
 */
export const jsonObject = z
  .string()
  .transform((raw, ctx) => {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const slice = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AI response is not parseable JSON" });
      return z.NEVER;
    }
  });

const confidence = z.coerce.number().min(0).max(1);

// ── Vision ──────────────────────────────────────────────────

const visionIngredientSchema = z.object({
  // Model may return its own name; catalog mapping happens after validation.
  name: z.string().trim().min(1).max(40),
  id: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  quantity: z
    .string()
    .trim()
    .max(24)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  confidence: confidence.default(0.5),
  quantity_confidence: confidence.optional(),
});

const visionAnalysisSchema = z.object({
  // Slightly-over lists are normalized (truncated to 12) rather than rejected;
  // truly absurd payloads (>50) fail validation and trigger the retry path.
  ingredients: z
    .array(visionIngredientSchema)
    .max(50)
    .transform((a) => a.slice(0, 12))
    .default([]),
  uncertain_items: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  notes: z.array(z.string().trim().min(1).max(140)).max(4).default([]),
});

export type VisionAnalysisPayload = z.infer<typeof visionAnalysisSchema>;

// ── Recommendations ─────────────────────────────────────────

const recommendationPickSchema = z.object({
  recipeId: z.string().trim().min(1).max(60),
  matchReason: z.array(z.string().trim().min(1).max(90)).max(4).default([]),
});

const recommendationPicksSchema = z.object({
  picks: z.array(recommendationPickSchema).min(1).max(4),
});

export type RecommendationPicksPayload = z.infer<typeof recommendationPicksSchema>;

// ── Cooking assistant ───────────────────────────────────────

const assistantReplySchema = z.object({
  answer: z.string().trim().min(1).max(600),
  tone: z.enum(["reassure", "instruct", "rescue"]).default("instruct"),
});

export type AssistantReplyPayload = z.infer<typeof assistantReplySchema>;

// Exported parse helpers — single enforcement point for "don't trust AI".

export function parseVisionAnalysis(raw: string): VisionAnalysisPayload | null {
  const parsed = jsonObject.pipe(visionAnalysisSchema).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseRecommendationPicks(raw: string): RecommendationPicksPayload | null {
  const parsed = jsonObject.pipe(recommendationPicksSchema).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseAssistantReply(raw: string): AssistantReplyPayload | null {
  const parsed = jsonObject.pipe(assistantReplySchema).safeParse(raw);
  return parsed.success ? parsed.data : null;
}
