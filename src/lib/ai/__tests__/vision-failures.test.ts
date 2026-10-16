// ─────────────────────────────────────────────────────────────
// RUCHI — vision failure-mode tests (client-side)
// ─────────────────────────────────────────────────────────────
// These exercise the REAL code the scan screen runs when analysis fails:
// - classifyVisionError (client-side failure taxonomy)
// - mapToAnalysis (post-response normalization + catalog fence)
// - prepareImageForVision (pre-service input rejection)
//
// They do NOT fake a working model. The service layer is the real
// GeminiIngredientVisionService; no mocked model responses, no fabricated
// ingredients. Mocked unit tests are NOT proof that live inference works —
// see VISION_ARCHITECTURE.md for the real-provider limitation.

import { beforeEach, describe, expect, it } from "vitest";
import { getVisionService } from "@/lib/ai";
import { classifyVisionError } from "@/lib/ai/errors";
import {
  clearAiEventsForTests,
  getLastVisionFallback,
  recordVisionFallback,
} from "@/lib/ai/observability";
import { mapToAnalysis } from "@/lib/ai/vision";
import { visionAnalysisToRows } from "@/lib/ai/scan";
import { prepareImageForVision } from "@/lib/ai/image";

function throwable(msg: string, opts?: Partial<Error>): Error {
  return Object.assign(new Error(msg), opts);
}

// ── 1. Failure taxonomy (the actual ScanScreen classifier) ───

describe("classifyVisionError", () => {
  it("a real service is wired and tries the route", () => {
    const svc = getVisionService();
    expect(svc).toBeDefined();
    expect(typeof svc.detectIngredients).toBe("function");
    expect(typeof svc.isAvailable).toBe("function");
  });

  it("AbortError is cancellation, not a failure message", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    expect(classifyVisionError(err)).toEqual({ kind: "abort" });
    // A plain Error tagged AbortError is classified the same way.
    expect(classifyVisionError(throwable("aborted", { name: "AbortError" }))).toEqual({
      kind: "abort",
    });
  });

  it("client fetch failures classify as network, not 'photo unreadable'", () => {
    expect(classifyVisionError(new TypeError("Failed to fetch"))).toEqual({
      kind: "network",
    });
    expect(
      classifyVisionError(
        throwable("NetworkError when attempting to fetch resource", { name: "Error" }),
      ),
    ).toEqual({ kind: "network" });
  });

  it("unknown errors classify as unavailable", () => {
    expect(classifyVisionError(new Error("boom"))).toEqual({ kind: "unavailable" });
    expect(classifyVisionError(new Error("503 not-configured"))).toEqual({
      kind: "unavailable",
    });
    expect(classifyVisionError("a string, not an error")).toEqual({
      kind: "unavailable",
    });
  });
});

// ── 2. Successful responses: empty vs uncertain vs matched ───

describe("mapToAnalysis (post-response normalization)", () => {
  it("an empty detection list is honest, not an error", () => {
    const analysis = mapToAnalysis([], 0);
    expect(analysis.ingredients).toEqual([]);
    expect(analysis.uncertainItems).toEqual([]);
    expect(analysis.modelUsed).toBeTruthy();
  });

  it("unmappable model names stay uncertain, never invent ids", () => {
    const analysis = mapToAnalysis(["quantum ketchup", "nebula cheese"], 0);
    for (const ing of analysis.ingredients) {
      expect(ing.catalogId).toBeDefined(); // only catalog-matched items survive
    }
    expect(analysis.uncertainItems.length).toBeGreaterThan(0);
  });

  it("the catalog fence cannot be bypassed by the model", () => {
    const analysis = mapToAnalysis(["egg", "magic-meat", "tomato"], 0);
    const ids = analysis.ingredients.map((i) => i.catalogId);
    expect(ids).toContain("egg");
    expect(ids).toContain("tomato");
    expect(ids).not.toContain("magic-meat");
  });
});

// ── 3. Uncertain detections survive to the confirm screen ────

describe("visionAnalysisToRows preserves uncertain guesses", () => {
  it("unmapped model names become confirmable rows, not dropped", () => {
    const analysis = mapToAnalysis(["eggs", "florbleberry"], 0);
    const rows = visionAnalysisToRows(analysis);
    const certain = rows.filter((r) => !r.uncertain);
    const uncertain = rows.filter((r) => r.uncertain);
    expect(certain.map((r) => r.id)).toContain("egg");
    expect(uncertain.map((r) => r.name)).toContain("florbleberry");
    // Uncertain rows carry no catalog id — the model cannot invent one.
    expect(uncertain.every((r) => r.id === undefined)).toBe(true);
  });

  it("an all-uncertain analysis still yields rows (not treated as nothing-found)", () => {
    const analysis = mapToAnalysis(["florbleberry", "zonkfruit"], 0);
    expect(analysis.ingredients).toHaveLength(0);
    const rows = visionAnalysisToRows(analysis);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.uncertain)).toBe(true);
  });
});

// ── 4. A real client network failure records reason=network ──

describe("service records WHY it fell back", () => {
  it("a client-side fetch failure is recorded as network, not a photo problem", async () => {
    recordVisionFallback("__reset__");
    const svc = getVisionService();
    // No server is reachable in the node test env → the client fetch throws.
    // The service must resolve null AND leave an honest reason behind.
    const res = await svc.detectIngredients({
      imageDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    });
    expect(res).toBeNull();
    expect(getLastVisionFallback()).toBe("network");
  });
});

// ── 5. Bad input is rejected before the service sees it ──────

describe("prepareImageForVision rejects bad input", () => {
  beforeEach(() => {
    clearAiEventsForTests();
  });

  it("rejects non-image files before any vision work", async () => {
    const pdf = new File(["x"], "scan.pdf", { type: "application/pdf" });
    const res = await prepareImageForVision(pdf);
    expect(res).toEqual({ ok: false, reason: "unsupported-type" });
  });

  it("rejects files that are too large before decoding", async () => {
    const big = new File([new Uint8Array(12_600_000)], "huge.jpg", {
      type: "image/jpeg",
    });
    const res = await prepareImageForVision(big);
    expect(res).toEqual({ ok: false, reason: "too-large" });
  });
});
