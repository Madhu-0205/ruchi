// Branding + auth-boundary regression tests.
// The vitest setup is node-environment .ts-only (no DOM, no tsx), so UI
// contracts are asserted against the SOURCE — the same discipline the
// live preview verifies visually. These tests lock:
//   1. one canonical logo asset, no stray copies
//   2. the logo renders on the auth card and Home hero (icon-only)
//   3. favicon + manifest wiring points at the official mark
//   4. auth flows never touch Puter; Puter auth helpers have no callers
//      outside the AI bridge

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** Strip JS/XML comments so assertions see code, not prose. */
function codeOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("brand: one canonical asset", () => {
  it("the canonical SVG exists and is icon-only (no wordmark)", () => {
    const svg = codeOf(read("public/ruchi-logo.svg"));
    expect(svg).toContain("<svg");
    // The standalone icon IS the mark — no text nodes, no wordmark, no
    // tagline inside the artwork itself.
    expect(svg).not.toContain("<text");
    expect(svg).not.toMatch(/>\s*RUCHI\s*</);
  });

  it("no duplicate logo copies scattered elsewhere", () => {
    const dupes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/^ruchi-logo/.test(entry.name) && p.endsWith(".svg")) dupes.push(p);
      }
    };
    walk(ROOT);
    expect(dupes).toEqual([path.join(ROOT, "public", "ruchi-logo.svg")]);
  });

  it("favicon + PWA PNG artifacts were generated from the canonical SVG", () => {
    for (const size of [32, 48, 64, 96, 128, 192, 512]) {
      expect(existsSync(path.join(ROOT, `public/ruchi-logo-${size}.png`)), `${size}px`).toBe(true);
    }
    expect(existsSync(path.join(ROOT, "public/ruchi-logo-apple-touch.png"))).toBe(true);
    expect(existsSync(path.join(ROOT, "public/ruchi-logo-maskable.png"))).toBe(true);
  });
});

describe("brand: integration points", () => {
  it("the shared auth card renders the logo (icon-only, centered)", () => {
    const src = read("src/components/AuthCard.tsx");
    expect(src).toContain("RuchiLogo");
    expect(src).toMatch(/<RuchiLogo size=\{44\} \/>/);
  });

  it("the welcome gate renders the logo prominently and uses the shared card", () => {
    const src = read("src/components/WelcomeGate.tsx");
    expect(src).toContain("RuchiLogo");
    expect(src).toMatch(/<RuchiLogo size=\{72\} priority \/>/);
    expect(src).toContain("AuthCard");
  });

  it("Home hero renders the logo at priority", () => {
    const src = read("src/components/screens/HomeScreen.tsx");
    expect(src).toContain("RuchiLogo");
    expect(src).toMatch(/<RuchiLogo size=\{28\} priority \/>/);
  });

  it("the logo component never adds wordmark text", () => {
    const src = codeOf(read("src/components/RuchiLogo.tsx"));
    // No visible text node carrying the brand name — alt text only.
    expect(src).not.toMatch(/>\s*RUCHI\s*</);
    expect(src).toContain('alt="RUCHI"');
  });

  it("root layout wires favicon, apple-touch icon and manifest", () => {
    const src = read("src/app/layout.tsx");
    expect(src).toContain('"/ruchi-logo-32.png"');
    expect(src).toContain('"/ruchi-logo.svg"');
    expect(src).toContain('"/ruchi-logo-apple-touch.png"');
    expect(src).toContain('"/manifest.webmanifest"');
  });

  it("the manifest uses any + maskable icons from the official mark", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    const anyIcons = manifest.icons.filter((i: { purpose?: string }) => i.purpose === "any");
    const maskable = manifest.icons.filter((i: { purpose?: string }) => i.purpose === "maskable");
    expect(anyIcons.length).toBeGreaterThanOrEqual(2);
    expect(maskable.length).toBe(1);
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^\/ruchi-logo-/);
    }
  });
});

describe("auth boundary: Puter never authenticates", () => {
  it("auth modules never import or reference the AI bridge", () => {
    for (const f of [
      "src/lib/auth/supabase.ts",
      "src/lib/auth/supabase-auth.ts",
      "src/lib/auth/supabase-data.ts",
    ]) {
      const src = codeOf(read(f));
      expect(src, f).not.toMatch(/lib\/ai|puter/i);
    }
  });

  it("Puter auth helpers have no callers outside the AI bridge", () => {
    for (const f of ["src/components/screens/HomeScreen.tsx", "src/components/screens/ProfileScreen.tsx"]) {
      const src = read(f);
      expect(src, `${f} must not call puter auth`).not.toMatch(/puterSignIn|puterSignOut|puter\.auth|puter\.user/);
    }
  });

  it("auth screens keep a startup-safe import graph (no eager SDK load)", () => {
    // The auth surfaces (welcome gate, shared card, Profile) import only
    // Supabase-backed store/auth modules — never a direct lib/ai module
    // that could touch the Puter SDK at import time.
    for (const f of [
      "src/components/AuthCard.tsx",
      "src/components/WelcomeGate.tsx",
      "src/components/screens/ProfileScreen.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/from "@\/lib\/ai\//);
    }
  });
});
