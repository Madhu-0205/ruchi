// ─────────────────────────────────────────────────────────────
// RUCHI — image preparation (client-side, pre-AI)
// ─────────────────────────────────────────────────────────────
// Validates type/size, downscales huge photos to a recognition-friendly
 // max dimension, and re-encodes to JPEG so the model gets a small, sharp
// image instead of a 6 MB camera dump. Keeps enough quality for labels,
// counts and package text.

import { MAX_IMAGE_BYTES } from "./config";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ImagePrepResult =
  | { ok: true; dataUrl: string; width: number; height: number; bytes: number }
  | { ok: false; reason: "unsupported-type" | "too-large" | "decode-failed" };

const MAX_DIMENSION = 1280; // plenty for ingredient recognition

export async function prepareImageForVision(file: File): Promise<ImagePrepResult> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return { ok: false, reason: "unsupported-type" };
  }
  if (file.size > 12 * 1024 * 1024) {
    return { ok: false, reason: "too-large" };
  }

  const bitmap = await decode(file);
  if (!bitmap) return { ok: false, reason: "decode-failed" };

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "decode-failed" };
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  if (typeof bitmap.close === "function") bitmap.close();

  // Start at high quality and step down until the payload fits the cap.
  let quality = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length * 0.75 > MAX_IMAGE_BYTES && quality > 0.4) {
    quality -= 0.15;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  canvas.width = 0; // release

  return {
    ok: true,
    dataUrl,
    width: w,
    height: h,
    bytes: Math.round(dataUrl.length * 0.75),
  };
}

async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(file);
    }
  } catch {
    // fall through to <img> decode
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img as unknown as ImageBitmap);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
