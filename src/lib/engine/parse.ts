// ─────────────────────────────────────────────────────────────
// RUCHI — natural language ingredient input
// ─────────────────────────────────────────────────────────────
// "I have eggs, 3 tomatoes, some paneer and rice" → catalog ids.
// Powers the text fallback when vision is unavailable, and the
// free-text "add" field. Deterministic, no AI required.

import { INGREDIENTS } from "@/lib/data/ingredients";
import type { Ingredient } from "@/lib/types";

export interface ParsedMention {
  ingredient: Ingredient;
  raw: string; // the matched text
  estimatedQty?: string; // "3", "some", "~200 g" when a quantity word adjoined
}

// Alias matching with overlap masking makes stop-word lists unnecessary:
// filler words simply never match a catalog alias.

function normalize(s: string): string {
  // digits preserved: quantities ("4 eggs") are read from the raw text
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Match a raw token span to a catalog ingredient by name/aliases. */
function matchToken(span: string): Ingredient | undefined {
  const s = normalize(span);
  if (!s) return undefined;
  // exact id/name/alias
  for (const ing of INGREDIENTS) {
    if (ing.id === s || ing.name.toLowerCase() === s) return ing;
  }
  for (const ing of INGREDIENTS) {
    if (ing.aliases.some((a) => a.toLowerCase() === s)) return ing;
  }
  // singular/plural tolerance
  const sing = s.endsWith("s") ? s.slice(0, -1) : s;
  for (const ing of INGREDIENTS) {
    const pool = [ing.name, ...ing.aliases].map((x) => x.toLowerCase());
    if (pool.some((p) => p === sing || p === `${sing}es`)) return ing;
  }
  return undefined;
}

/**
 * Parse free text into catalog mentions. Finds EVERY ingredient mentioned —
 * "I have 4 eggs, some paneer, 2 tomatoes, onion and rice" → all five.
 * Longest alias wins ("spring onion" beats "onion"), matched spans are
 * masked so one word can't serve two ingredients. Unknown words are
 * ignored — the UI asks the user to confirm the list, so a miss is safe.
 */
export function parseIngredientText(text: string): ParsedMention[] {
  const clean = normalize(text);
  if (!clean) return [];

  // Build every (alias → position) candidate across the whole text.
  interface Cand {
    ing: Ingredient;
    alias: string;
    start: number;
    end: number;
  }
  const cands: Cand[] = [];
  for (const ing of INGREDIENTS) {
    const names = new Set([ing.name, ing.id, ...ing.aliases].map((n) => normalize(n)));
    // simple English plurals so "tomatoes"/"eggs"/"onions" match their alias
    for (const a of [...names]) {
      if (a.endsWith("s")) continue;
      names.add(`${a}s`);
      if (/(s|x|z|ch|sh)$/.test(a)) names.add(`${a}es`);
      if (/o$/.test(a)) names.add(`${a}es`); // tomatoes, potatoes
    }
    for (const alias of names) {
      if (!alias) continue;
      const re = new RegExp(`(?<![a-z])${alias.replace(/[^a-z ]/g, "")}(?![a-z])`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(clean)) !== null) {
        cands.push({ ing, alias, start: m.index, end: m.index + alias.length });
      }
    }
  }

  // Longest alias first, then earliest position; drop overlapping hits.
  cands.sort((a, b) => b.alias.length - a.alias.length || a.start - b.start);
  const accepted: Cand[] = [];
  for (const c of cands) {
    if (accepted.some((a) => c.start < a.end && a.start < c.end)) continue;
    accepted.push(c);
  }
  accepted.sort((a, b) => a.start - b.start);

  const out: ParsedMention[] = [];
  const seen = new Set<string>();
  for (const c of accepted) {
    if (seen.has(c.ing.id)) continue;
    seen.add(c.ing.id);
    // quantity words just before the match: "4 eggs", "some paneer",
    // "3 cloves garlic", "half a lemon"
    const before = clean.slice(Math.max(0, c.start - 18), c.start).trim();
    const numMatch =
      before.match(/(\d+)\s+(?:cloves?|pieces?|slices?)\s*$/) ?? before.match(/(\d+)\s*$/);
    // filler articles allowed between quantity word and ingredient:
    // "half a lemon", "some of the paneer"
    const vagueMatch = before.match(/\b(some|few|lots|plenty|half)\b(?:\s+(?:of|a|an|the)\s*)*$/);
    let estimatedQty: string | undefined;
    if (numMatch?.[1]) estimatedQty = numMatch[1];
    else if (vagueMatch?.[1] === "half") estimatedQty = "½";
    else if (vagueMatch?.[1]) estimatedQty = "some";
    out.push({ ingredient: c.ing, raw: c.alias, estimatedQty });
  }
  return out;
}

/** Suggest catalog ids for a free-text query (used by the add-row). */
export function bestMatch(query: string): Ingredient | undefined {
  const parsed = parseIngredientText(query);
  return parsed[0]?.ingredient ?? matchToken(query);
}
