// ─────────────────────────────────────────────────────────────
// RUCHI — POST /api/vision
// ─────────────────────────────────────────────────────────────
// IngredientVisionService endpoint. Photo in (base64 data URL), detected
// ingredients out. Server-side only: the AI key never reaches the browser.
// Photos are processed in-memory and never written to disk.

import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeImage } from "@/lib/ai";
import { track } from "@/lib/engine/analytics";

const bodySchema = z.object({
  // data URL from a camera/gallery file, jpeg or png, bounded size
  image: z
    .string()
    .startsWith("data:image/")
    .max(6_000_000), // ~4.5 MB binary after base64 overhead
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Send { image: dataURL } — jpeg/png under ~4MB." },
      { status: 400 },
    );
  }

  const result = await analyzeImage(parsed.data.image);

  if (!result) {
    // Provider missing or failed — client falls back to text entry.
    return NextResponse.json(
      { ok: false, reason: "vision-unavailable" },
      { status: 200 },
    );
  }

  track("ingredient_added", { source: "photo", count: result.items.length });

  return NextResponse.json({ ok: true, ...result });
}
