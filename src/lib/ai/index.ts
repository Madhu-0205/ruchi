// ─────────────────────────────────────────────────────────────
// RUCHI — AI service layer
// ─────────────────────────────────────────────────────────────
// Every AI capability sits behind an interface with a deterministic
// fallback, so the app is fully functional with zero API keys.
//
// Provider selection: AI_PROVIDER env var, else first available key
// (openai → anthropic), else "none" (fallbacks only).
//
// EXTENSION POINTS (already wired):
//  - addVisionSupport(): camera ingredient recognition
//  - helpAnswer(): live contextual answers during Cooking Mode
//  - nudgeCopy(): personalized re-engagement copy

import { z } from "zod";
import { aiHelpAnswerSchema, type AiHelpAnswer } from "@/lib/data/schemas";

export type AiProviderName = "openai" | "anthropic" | "none";

export function detectProvider(): AiProviderName {
  const forced = process.env.AI_PROVIDER as AiProviderName | undefined;
  if (forced === "openai" || forced === "anthropic" || forced === "none") return forced;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}

export const aiEnabled = () => detectProvider() !== "none";

async function callProvider(system: string, user: string): Promise<string | null> {
  const provider = detectProvider();
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return json.choices?.[0]?.message?.content ?? null;
    }
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
          max_tokens: 500,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { content?: { text?: string }[] };
      return json.content?.map((c) => c.text ?? "").join("") || null;
    }
  } catch {
    // Network errors, timeouts, provider outages → fall through to null.
  }
  return null;
}

function parseJson<T>(raw: string | null, schema: z.ZodType<T>): T | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return schema.safeParse(JSON.parse(raw.slice(start, end + 1))).data ?? null;
  } catch {
    return null;
  }
}

// ── Capability: contextual cooking help ─────────────────────

export interface HelpContext {
  recipeName: string;
  stepTitle: string;
  stepText: string;
  question: string;
  hasIngredientNames?: string[];
}

const HELP_SYSTEM = `You are RUCHI's cooking assistant — warm, young, Indian, encouraging, never preachy. You answer a beginner's question about the exact step they are on. Max 90 words. Plain text only, no markdown, no lists. Be specific and actionable. Never suggest anything unsafe. If the user burned something, tell them the rescue calmly.`;

export async function helpAnswer(ctx: HelpContext): Promise<AiHelpAnswer | null> {
  const user = `Recipe: ${ctx.recipeName}
Current step: ${ctx.stepTitle}
Step instruction: ${ctx.stepText}
User question: ${ctx.question}

Reply with JSON: {"answer": string, "tone": "reassure"|"instruct"|"rescue"}`;
  const raw = await callProvider(HELP_SYSTEM, user);
  return parseJson(raw, aiHelpAnswerSchema);
}

// ── Capability: ingredient vision ───────────────────────────
// IngredientVisionService — server-side only. The browser posts the photo
// to /api/vision; the API key never leaves the server.

export interface DetectedItem {
  /** Catalog id when confidently matched, otherwise a raw label. */
  id?: string;
  name: string;
  confidence: number; // 0..1
  estimatedQuantity?: string; // "4", "~200 g", "1 packet"
  uncertain: boolean; // low confidence or ambiguous — user must confirm
}

export interface VisionResult {
  items: DetectedItem[];
  providerUsed: AiProviderName;
  lowConfidence: boolean; // any uncertain item present
}

// The model may only answer with these ids — this is what kills hallucinated
// ingredients. Anything not on the list arrives back as an uncertain guess.
const VISION_CATALOG = [
  "egg", "paneer", "chicken-breast", "tofu", "soya-chunks", "curd", "milk",
  "onion", "tomato", "potato", "capsicum", "carrot", "green-chili", "peas",
  "spinach", "cabbage", "cauliflower", "spring-onion", "lemon",
  "coriander-leaves", "rice", "bread", "oats", "poha", "atta",
  "moong-dal", "toor-dal", "peanut", "ginger", "garlic", "butter", "ghee",
];

const VISION_SYSTEM = `You identify visible food ingredients in a photo of a kitchen counter, fridge, groceries or pantry.
Rules:
- Identify ONLY ingredients from this list: ${VISION_CATALOG.join(", ")}.
- For each, give confidence 0-1 and estimatedQuantity like "4" or "~200 g" (omit if unknowable).
- If something looks like food but you cannot confidently map it to the list, return it with its best-guess name and confidence <= 0.5 and uncertain=true.
- Never invent items that are not visible. No packaging brands. No cooked dishes, no utensils, no people.
- Return at most 12 items. Empty array if nothing identifiable.
Reply ONLY with JSON: {"items":[{"name":string,"id":string|null,"confidence":number,"estimatedQuantity":string|null,"uncertain":boolean}]}`;

export const visionCatalogIds = VISION_CATALOG;

export async function analyzeImage(base64DataUrl: string): Promise<VisionResult | null> {
  const provider = detectProvider();
  if (provider === "none") return null;
  try {
    let raw: string | null = null;
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
          messages: [
            { role: "system", content: VISION_SYSTEM },
            {
              role: "user",
              content: [
                { type: "text", text: "What ingredients do you see?" },
                { type: "image_url", image_url: { url: base64DataUrl } },
              ],
            },
          ],
          max_tokens: 700,
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      raw = json.choices?.[0]?.message?.content ?? null;
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_VISION_MODEL ?? "claude-3-5-sonnet-latest",
          max_tokens: 700,
          system: VISION_SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/jpeg", data: base64DataUrl.replace(/^data:image\/\w+;base64,/, "") },
                },
                { type: "text", text: "What ingredients do you see?" },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { content?: { text?: string }[] };
      raw = json.content?.map((c) => c.text ?? "").join("") || null;
    }
    const parsed = parseJson(
      raw,
      z.object({
        items: z
          .array(
            z.object({
              name: z.string().min(1).max(40),
              id: z.string().max(40).nullable().optional(),
              confidence: z.number().min(0).max(1),
              estimatedQuantity: z.string().max(24).nullable().optional(),
              uncertain: z.boolean().optional(),
            }),
          )
          .max(12),
      }),
    );
    if (!parsed) return null;
    const allowed = new Set(VISION_CATALOG);
    const items: DetectedItem[] = (parsed.items ?? [])
      .filter((it) => it.confidence >= 0.2 || it.uncertain)
      .map((it) => {
        const id = it.id && allowed.has(it.id) ? it.id : undefined;
        const uncertain = it.uncertain ?? (!id || it.confidence < 0.55);
        return {
          id,
          name: it.name,
          confidence: Math.round(it.confidence * 100) / 100,
          estimatedQuantity: it.estimatedQuantity ?? undefined,
          uncertain,
        };
      });
    return {
      items,
      providerUsed: provider,
      lowConfidence: items.some((i) => i.uncertain),
    };
  } catch {
    return null;
  }
}

// ── Capability: personalized nudge copy ─────────────────────

export async function nudgeCopy(_context: {
  kind: string;
  inventoryTop?: string[];
  stats?: { meals: number; saved: number; streak: number };
}): Promise<{ title: string; body: string } | null> {
  // Deterministic nudge engine handles MVP copy; see lib/engine/nudge.ts.
  // When AI is enabled this can generate personalized variations.
  return null;
}
