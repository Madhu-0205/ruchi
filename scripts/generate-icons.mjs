// ─────────────────────────────────────────────────────────────
// RUCHI — icon rasterizer (dev dependency: sharp, already installed)
// ─────────────────────────────────────────────────────────────
// Rasterizes the canonical public/ruchi-logo.svg into the PNG sizes the
// favicon + web app manifest need. Run manually after changing the logo:
//
//   node scripts/generate-icons.mjs
//
// The SVG stays the single source of truth; these PNGs are build artifacts
// of it. All sizes are square, aspect-preserving, no borders or shadows —
// the rounded corners live in the SVG itself.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "public", "ruchi-logo.svg");
const OUT_DIR = path.join(ROOT, "public");

const SIZES = [32, 48, 64, 96, 128, 192, 512];

const svg = await readFile(SRC, "utf8");
await mkdir(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const out = path.join(OUT_DIR, `ruchi-logo-${size}.png`);
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`✓ ${path.relative(ROOT, out)}`);
}

// Apple touch icon: iOS composites its own rounded corners, so this one is
// rendered on an opaque cream background at full-bleed square proportions.
const apple = await sharp(Buffer.from(svg), { density: 384 })
  .resize(180, 180, { fit: "contain", background: { r: 0xfb, g: 0xf7, b: 0xf1, alpha: 1 } })
  .png()
  .toBuffer();
await writeFile(path.join(OUT_DIR, "ruchi-logo-apple-touch.png"), apple);
console.log("✓ public/ruchi-logo-apple-touch.png");

// Maskable icon (Android adaptive): full-bleed opaque flame square with the
// mark scaled into the safe zone (inner ~80% circle) so circular masks never
// clip the R or the leaf.
const MARK = 400; // 512 * 0.78 — inside the 80% safe zone
const mark = await sharp(Buffer.from(svg), { density: 384 })
  .resize(MARK, MARK, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 0xe4, g: 0x57, b: 0x2e, alpha: 1 } },
})
  .composite([{ input: mark, left: Math.round((512 - MARK) / 2), top: Math.round((512 - MARK) / 2) }])
  .png()
  .toFile(path.join(OUT_DIR, "ruchi-logo-maskable.png"));
console.log("✓ public/ruchi-logo-maskable.png");
