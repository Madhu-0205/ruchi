// ─────────────────────────────────────────────────────────────
// RUCHI — dataUrlToFile regression tests
// ─────────────────────────────────────────────────────────────
// These lock in the fix for the scan-breaking bug: the vision client used
// `fetch(dataUrl)` to turn the preprocessed image into a File, but the
// production CSP (`connect-src 'self' https://*.supabase.co`, see
// next.config.ts) makes a fetch to a `data:` URL a connect-src request the
// browser blocks with a SecurityPolicyViolation. Every photo scan then
// failed with an opaque "Failed to fetch" — before any network call — while
// Node-based tests stayed green because Node's fetch permits data: URLs.
//
// The decoder must therefore work with NO fetch at all.

import { describe, expect, it } from "vitest";
import { dataUrlToFile } from "@/lib/ai/vision";

// 1x1 transparent PNG.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("dataUrlToFile (CSP-safe image decoding)", () => {
  it("decodes a base64 PNG into a File with correct bytes and type", async () => {
    const file = await dataUrlToFile(`data:image/png;base64,${PNG_1x1}`);
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("ingredients.jpg");

    const bytes = new Uint8Array(await file.arrayBuffer());
    // PNG magic number — proves the payload survived byte-for-byte.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeGreaterThan(8);
  });

  it("never calls fetch (the CSP-broken path)", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error("fetch must not be used for data: URLs under CSP");
    }) as typeof fetch;
    try {
      await dataUrlToFile(`data:image/png;base64,${PNG_1x1}`);
    } finally {
      globalThis.fetch = original;
    }
    expect(called).toBe(false);
  });

  it("honours the declared image type for each accepted format", async () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      const file = await dataUrlToFile(`data:${type};base64,${PNG_1x1}`);
      expect(file.type).toBe(type);
    }
  });

  it("falls back to image/jpeg for an unknown declared type", async () => {
    const file = await dataUrlToFile(`data:application/octet-stream;base64,${PNG_1x1}`);
    expect(file.type).toBe("image/jpeg");
  });

  it("rejects a malformed data URL instead of uploading garbage", async () => {
    await expect(dataUrlToFile("not-a-data-url")).rejects.toThrow();
  });
});
