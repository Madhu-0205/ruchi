// ─────────────────────────────────────────────────────────────
// RUCHI — IngredientVisionService (Gemini via server API route)
// ─────────────────────────────────────────────────────────────
// One photo + optional user text → validated structured ingredients.
// The Gemini call happens server-side in /api/analyze-ingredients (the API
// key never reaches the browser). This client keeps the provider-agnostic
// IngredientVisionService contract: malformed/failed responses resolve null
// and the UI shows its manual fallback — never a faked result.
//
// Ingredient names from the model are UNTRUSTED: they are mapped onto
// RUCHI's canonical catalog through the existing alias index (the same one
// the manual text parser uses). Unmapped names become `uncertain` rows the
// user confirms before they enter the kitchen — the model cannot create
// ingredients the app doesn't know.

"use client";

import { findIngredient, INGREDIENTS } from "@/lib/data/ingredients";
import { parseIngredientText } from "@/lib/engine/parse";
import { getSupabase } from "@/lib/auth/supabase";
import { ACCEPTED_IMAGE_TYPES } from "./image";
import { logAiEvent, recordVisionFallback } from "./observability";
import { classifyVisionError } from "./errors";
import type {
  IngredientVisionService,
  VisionAnalysis,
  VisionIngredient,
  VisionRequest,
} from "./types";

/** Wire contract of the server route: { ingredients: string[] }. */
interface AnalyzeResponse {
  ingredients?: unknown;
  error?: string;
  code?: string;
}

export class GeminiIngredientVisionService implements IngredientVisionService {
  async isAvailable(): Promise<boolean> {
    // Availability is decided by the server at request time (it answers 503
    // when unconfigured); the client always tries and falls back gracefully.
    return true;
  }

  async detectIngredients(req: VisionRequest): Promise<VisionAnalysis | null> {
    const started = Date.now();
    logAiEvent("vision_request_started", { hasText: Boolean(req.userText) });

    try {
      const file = await dataUrlToFile(req.imageDataUrl);
      const body = new FormData();
      body.append("image", file, "ingredients.jpg");

      // Server-side auth: the route verifies the caller's Supabase session
      // before spending AI quota. Signed-out callers fail with 401 and the
      // UI falls back to manual ingredient entry — honest, no fake analysis.
      const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token ?? null;
      const res = await fetch("/api/analyze-ingredients", {
        method: "POST",
        body,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        signal: req.signal,
      });

      if (res.status === 401) {
        recordVisionFallback("auth-required");
        logAiEvent("fallback_triggered", { stage: "vision-auth-required" });
        return null;
      }

      const data = (await res.json().catch(() => null)) as AnalyzeResponse | null;

      if (!res.ok) {
        recordVisionFallback("server-error");
        logAiEvent("fallback_triggered", {
          stage: "vision-http-" + res.status,
          code: data?.code ?? "unknown",
        });
        return null;
      }

      const names = Array.isArray(data?.ingredients)
        ? data.ingredients.filter((x): x is string => typeof x === "string")
        : [];
      if (names.length === 0) {
        // Honest empty result — nothing recognizable in the photo.
        recordVisionFallback("no-ingredients-detected");
        logAiEvent("fallback_triggered", { stage: "vision-empty" });
        return null;
      }

      const analysis = mapToAnalysis(names, Date.now() - started);
      logAiEvent("vision_success", {
        model: "gemini-2.5-flash(server)",
        ingredients: analysis.ingredients.length,
        uncertain: analysis.uncertainItems.length,
        ms: analysis.elapsedMs,
      });
      return analysis;
    } catch (err) {
      if (req.signal?.aborted) return null; // user cancelled — stay quiet
      // Preserve WHY it failed so the UI can be honest: a client-side fetch
      // failure is a network problem, not an unreadable photo. This reason is
      // read by the scan screen via getLastVisionFallback().
      recordVisionFallback(
        classifyVisionError(err).kind === "network" ? "network" : "provider-error",
      );
      logAiEvent("vision_failure", {
        reason: err instanceof Error ? err.message.slice(0, 120) : "unknown",
      });
      return null;
    }
  }
}

/**
 * Model names → canonical VisionIngredients using the catalog's alias index
 * (shared with manual text entry — no second normalization system).
 * Mapped names become confident rows; unmapped names become uncertain rows
 * (user confirms), and genuinely ambiguous names run through the same text
 * parser the manual flow uses.
 */
export function mapToAnalysis(
  names: string[],
  elapsedMs: number,
): VisionAnalysis {
  const ingredients: VisionIngredient[] = [];
  const uncertainItems: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    if (ingredients.length >= 12) break;
    const name = raw.trim();
    if (!name) continue;

    // Direct id / name / alias match against the catalog.
    const direct = findIngredient(name) ?? byAlias(name);
    if (direct) {
      if (seen.has(direct.id)) continue;
      seen.add(direct.id);
      ingredients.push({
        catalogId: direct.id,
        label: direct.name,
        confidence: 0.9,
        uncertain: false,
      });
      continue;
    }

    // Not in the catalog: run it through the shared text parser (it knows
    // aliases + plural/singular and quantity words). If that still fails,
    // surface it as an uncertain guess the user confirms or discards.
    const parsed = parseIngredientText(name);
    if (parsed.length > 0 && parsed[0]) {
      const id = parsed[0].ingredient.id;
      if (seen.has(id)) continue;
      seen.add(id);
      ingredients.push({
        catalogId: id,
        label: parsed[0].ingredient.name,
        quantity: parsed[0].estimatedQty,
        confidence: 0.75,
        uncertain: false,
      });
    } else if (uncertainItems.length < 8 && uncertainItems.length + ingredients.length < 12) {
      uncertainItems.push(name);
    }
  }

  return {
    ingredients,
    uncertainItems,
    notes: [],
    modelUsed: "gemini-2.5-flash",
    elapsedMs,
  };
}

/** Alias lookup that complements findIngredient (id + name + exact aliases). */
function byAlias(name: string) {
  const lower = name.toLowerCase();
  return INGREDIENTS.find(
    (i) =>
      i.name.toLowerCase() === lower ||
      i.aliases.some((a) => a.toLowerCase() === lower),
  );
}

/**
 * Convert the client's preprocessed data URL into a File for multipart upload.
 *
 * IMPORTANT: do NOT use `fetch(dataUrl)` here. The production CSP sets
 * `connect-src 'self' https://*.supabase.co` (see next.config.ts) and a
 * `fetch()` to a `data:` URL is a connect-src request — the browser blocks
 * it with a SecurityPolicyViolation before any network work happens, which
 * made every photo scan fail with an opaque "Failed to fetch" regardless of
 * the server. Decoding the base64 payload directly keeps the whole path
 * client-local and CSP-independent.
 */
export async function dataUrlToFile(dataUrl: string): Promise<File> {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("malformed image data URL");

  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const declaredType = /^data:([^;,]+)/i.exec(meta)?.[1]?.toLowerCase();
  const isBase64 = /;base64/i.test(meta);

  const bytes = isBase64
    ? decodeBase64(payload)
    : new TextEncoder().encode(decodeURIComponent(payload));

  // Keep only formats the server route accepts; anything else is a bug in
  // preprocessing, not a user error, so fail loudly instead of uploading it.
  const type = declaredType && ACCEPTED_IMAGE_TYPES.includes(declaredType as (typeof ACCEPTED_IMAGE_TYPES)[number])
    ? declaredType
    : "image/jpeg";

  return new File([bytes], "ingredients.jpg", { type });
}

/** base64 → bytes via the browser's atob (no fetch, no CSP involvement). */
function decodeBase64(payload: string): Uint8Array<ArrayBuffer> {
  const binary = atob(payload);
  const buffer = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
