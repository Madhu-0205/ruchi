// ─────────────────────────────────────────────────────────────
// RUCHI — POST /api/analyze-ingredients (server-only)
// ─────────────────────────────────────────────────────────────
// One photo → Gemini Flash vision → normalized ingredient names.
// GEMINI_API_KEY lives only here, on the server — never in a client
// bundle. The response is untrusted model output: validated, trimmed,
// lowercased, deduplicated, and capped before it reaches the app.

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Largest upload accepted (client already compresses to ~1.4 MB). */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 25_000;

/**
 * The vision prompt. Ingredient names come back as plain English; mapping to
 * RUCHI's canonical catalog ids happens in the app via its existing alias
 * index (findIngredient/searchIngredients), which owns normalization.
 */
const VISION_PROMPT = `Analyze this photo carefully.

List every visible food ingredient that can be used for cooking:
vegetables, fruits, dairy, proteins, spices, grains, pulses, etc.

Focus on ingredients commonly used in Indian home cooking.

Rules:
- Return only structured JSON matching the requested schema.
- Ingredient names must be in English lowercase.
- Use simple common ingredient names (for example: tomato, onion, paneer, eggs, rice, curd).
- Do not include utensils.
- Do not include plates, bowls, containers, countertops, or other non-food items.
- Do not include packaging as an ingredient.
- Do not invent ingredients that are not visibly present.
- Only include ingredients that are reasonably identifiable.
- Avoid duplicate ingredients.
- Prefer RAW ingredients over cooked dishes: name the items you can see, not the meal they might become.
- If nothing is clearly identifiable, return an empty ingredients array.`;

/** Wire contract: { "ingredients": ["tomato", …] } — everything else fails validation. */
const geminiResultSchema = z.object({
  ingredients: z
    .array(z.unknown())
    .max(50)
    .default([])
    .transform((arr) =>
      Array.from(
        new Set(
          arr
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0 && s.length <= 40),
        ),
      ).slice(0, 12),
    ),
});

const ANALYSIS_FAILED =
  "I couldn't identify the ingredients from that image. Please try another clearer photo.";

function errorResponse(status: number, message: string, code: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[analyze-ingredients] GEMINI_API_KEY is not configured");
    return errorResponse(
      503,
      "Ingredient analysis isn't set up on the server yet. Please try again later.",
      "not-configured",
    );
  }

  // ── Image validation ──────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(400, "Please send the photo as a multipart upload.", "bad-request");
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return errorResponse(400, "No photo was attached. Please try again.", "missing-image");
  }
  const type = (file.type || "").toLowerCase();
  if (!ACCEPTED_TYPES.includes(type as (typeof ACCEPTED_TYPES)[number])) {
    return errorResponse(400, "That file isn't a supported photo. JPEG, PNG or WebP please.", "bad-type");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse(400, "That photo is too large. Please try a smaller one.", "too-large");
  }
  if (file.size < 512) {
    return errorResponse(400, "That photo looks empty. Please try again.", "bad-type");
  }

  // ── Gemini call ───────────────────────────────────────────
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: type, data: Buffer.from(bytes).toString("base64") } },
            { text: VISION_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            ingredients: { type: "array", items: { type: "string" } },
          },
          required: ["ingredients"],
        },
        temperature: 0.1,
        abortSignal: controller.signal,
      },
    });

    const parsed = geminiResultSchema.safeParse(safeJson(response.text ?? ""));
    if (!parsed.success) {
      console.error("[analyze-ingredients] invalid Gemini JSON");
      return errorResponse(502, ANALYSIS_FAILED, "invalid-response");
    }

    // An empty list is a valid answer ("nothing recognizable"), not an error.
    return NextResponse.json({ ingredients: parsed.data.ingredients });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[analyze-ingredients] Gemini call failed:", msg);
    if (/aborted|timeout|deadline|ETIMEDOUT/i.test(msg)) {
      return errorResponse(504, ANALYSIS_FAILED, "timeout");
    }
    if (/429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg)) {
      return errorResponse(
        429,
        "Ingredient analysis is busy right now. Please try again in a moment.",
        "rate-limited",
      );
    }
    if (/SAFETY|blocked|RECITATION/i.test(msg)) {
      return errorResponse(502, ANALYSIS_FAILED, "blocked");
    }
    return errorResponse(502, ANALYSIS_FAILED, "upstream-failure");
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const slice = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    return null;
  }
}
