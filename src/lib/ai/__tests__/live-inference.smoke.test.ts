// ─────────────────────────────────────────────────────────────
// RUCHI — LIVE vision inference smoke test (opt-in)
// ─────────────────────────────────────────────────────────────
// This is NOT a mocked test. It makes a REAL Gemini vision call using the
// same model/prompt/schema as /api/analyze-ingredients, then runs the real
// response through the app's schema + catalog mapping.
//
// Skipped by default so CI stays hermetic and key-free. Run explicitly:
//   LIVE_VISION=1 npx vitest run src/lib/ai/__tests__/live-inference.smoke.test.ts
//
// It uses the committed synthetic fixture (no real user images) and requires
// GEMINI_API_KEY in .env.local.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { mapToAnalysis } from "@/lib/ai/vision";
import { visionAnalysisToRows } from "@/lib/ai/scan";

const LIVE = process.env.LIVE_VISION === "1";

function readKey(): string | null {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const line = fs
      .readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith("GEMINI_API_KEY="));
    return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

// The route's wire contract, reused verbatim.
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

describe.skipIf(!LIVE)("LIVE Gemini vision inference", () => {
  it("identifies the synthetic produce image and passes app validation", async () => {
    const key = readKey();
    expect(key, "GEMINI_API_KEY must be configured").toBeTruthy();
    const fixture = "src/lib/ai/__tests__/fixtures/synthetic-produce.png";
    expect(fs.existsSync(fixture), "synthetic fixture must exist").toBe(true);

    const bytes = fs.readFileSync(fixture);
    const ai = new GoogleGenAI({ apiKey: key as string });
    const started = Date.now();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } },
            { text: "List every visible food ingredient in this photo as JSON {ingredients:[...]}. English lowercase, common names, no utensils." },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: { ingredients: { type: "array", items: { type: "string" } } },
          required: ["ingredients"],
        },
        temperature: 0.1,
      },
    });

    const elapsed = Date.now() - started;
    const parsed = geminiResultSchema.safeParse(safeJson(response.text ?? ""));
    expect(parsed.success, "real response must satisfy the route schema").toBe(true);
    if (!parsed.success) return;

    const names = parsed.data.ingredients;
    console.log(`[LIVE] ${elapsed}ms →`, names.join(", "));
    expect(names.length).toBeGreaterThan(0);

    // Real response flows through the app's mapping + row builder unchanged.
    const analysis = mapToAnalysis(names, elapsed);
    const rows = visionAnalysisToRows(analysis);
    expect(rows.length).toBeGreaterThan(0);
    // The image contains tomato, onion, potato and chilli.
    const labels = analysis.ingredients.map((i) => i.catalogId);
    expect(labels).toEqual(expect.arrayContaining(["tomato", "onion"]));
  }, 40_000);
});
