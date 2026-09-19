// ─────────────────────────────────────────────────────────────
// RUCHI — quantity formatting
// ─────────────────────────────────────────────────────────────
// Beginners don't think in 0.5. They think "½ medium onion".

import type { Ingredient, RecipeIngredient, Unit } from "@/lib/types";

const FRACTIONS: [number, string][] = [
  [0.25, "¼"],
  [0.33, "⅓"],
  [0.5, "½"],
  [0.66, "⅔"],
  [0.75, "¾"],
];

export function formatNumber(n: number): string {
  const rounded = Math.round(n * 4) / 4; // snap to quarter
  // only snap when the snap is honest: printing 2½ for 2.4 would confuse
  if (Math.abs(rounded - n) > 0.1) return String(Math.round(n * 10) / 10);
  const whole = Math.floor(rounded);
  const frac = rounded - whole;
  if (frac < 0.125) return String(whole);
  for (const [v, sym] of FRACTIONS) {
    if (Math.abs(frac - v) < 0.08) return whole > 0 ? `${whole}${sym}` : sym;
  }
  return String(Math.round(n * 10) / 10);
}

const UNIT_LABEL: Record<Unit, string> = {
  count: "",
  g: "g",
  ml: "ml",
  tbsp: "tbsp",
  tsp: "tsp",
  cup: "cup",
  clove: "clove",
  packet: "packet",
};

export function unitLabel(u: Unit, qty: number): string {
  if (u === "clove") return qty === 1 ? "clove" : "cloves";
  if (u === "cup") return qty === 1 ? "cup" : "cups";
  if (u === "packet") return qty === 1 ? "packet" : "packets";
  return UNIT_LABEL[u];
}

/**
 * Format a recipe ingredient for a given serving count, e.g.
 * "2 Eggs", "100 g Paneer", "½ medium Onion", "1½ tbsp Oil".
 */
export function formatQuantity(
  ri: RecipeIngredient,
  servings: number,
  ing?: Ingredient,
): string {
  const baselineServings = 2;
  const factor =
    ri.scalable ? servings / baselineServings : servings > baselineServings ? 1.5 : 1;
  const qty = ri.qty * factor;

  if (ri.unit === "count" && ing?.avgPieceG) {
    // count-based produce: "½ medium Onion"
    const whole = Math.floor(qty);
    const frac = qty - whole;
    const fracSym =
      FRACTIONS.find(([v]) => Math.abs(frac - v) < 0.08)?.[1] ?? "";
    const size = ing.avgPieceG >= 110 ? "medium" : "small";
    const num = whole > 0 ? `${whole}${fracSym}` : fracSym;
    if (ing.id === "egg") return num || "1";
    return `${num} ${size}`;
  }
  if (ri.unit === "count") return formatNumber(qty);
  // Spoon measures only exist in ¼-steps in a real kitchen — always snap.
  // "0.4 tsp turmeric" is machine talk; "½ tsp" is what a cookbook prints.
  if (ri.unit === "tsp" || ri.unit === "tbsp") {
    return `${formatNumber(Math.round(qty * 4) / 4)} ${UNIT_LABEL[ri.unit]}`;
  }
  return `${formatNumber(qty)} ${UNIT_LABEL[ri.unit]}`;
}

export function quantityForGrams(ri: RecipeIngredient, servings: number, ing: Ingredient): number {
  const factor = ri.scalable ? servings / 2 : 1;
  const qty = ri.qty * factor;
  if (ri.unit === "count" && ing.avgPieceG) return qty * ing.avgPieceG;
  if (ri.unit === "g" || ri.unit === "ml") return qty;
  if (ri.unit === "tbsp") return qty * 15;
  if (ri.unit === "tsp") return qty * 5;
  if (ri.unit === "cup") return qty * 200;
  if (ri.unit === "clove") return qty * (ing.avgPieceG ?? 3);
  if (ri.unit === "packet") return qty * 100;
  return qty;
}

export function scaleForServings(ri: RecipeIngredient, servings: number): number {
  const factor = ri.scalable ? servings / 2 : servings > 2 ? 1.5 : 1;
  return Math.round(ri.qty * factor * 100) / 100;
}

// ── Step-text scaling ───────────────────────────────────────
// Recipe steps are written for the 2-serving baseline. When the user picks
// a different serving count we scale the quantity mentions inside the text
// itself — beginners should never do portion math. Only quantity units and
// countable foods scale; times, temperatures and ratios never do.

const FRACTION_VALUES: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
};

function parseQty(raw: string): number {
  if (FRACTION_VALUES[raw] !== undefined) return FRACTION_VALUES[raw];
  const m = raw.match(/^(\d+)([¼½¾⅓⅔])?$/);
  if (m) {
    const whole = parseInt(m[1] ?? "0", 10);
    const frac = m[2] ? (FRACTION_VALUES[m[2]] ?? 0) : 0;
    return whole + frac;
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

// quantity units + countable foods, written as singular stems (plurals are
// consumed by the (?:es|s)? group so "1 tomato" scales too);
// "minutes", "seconds", "°C", "cm", "1:2" never match
const QTY_PATTERN =
  /(\d+(?:\.\d+)?|[¼½¾⅓⅔]|\d+[¼½¾⅓⅔])\s?(g|ml|tbsp|tsp|cup|clove|egg|onion|tomato|green\s?chili|chili|chilli|carrot|potato|capsicum|slice)(?:es|s)?\b/g;

export function scaleStepText(text: string, factor: number): string {
  if (factor === 1) return text;
  return text.replace(QTY_PATTERN, (match, numRaw: string, unit: string) => {
    const qty = parseQty(numRaw);
    if (!Number.isFinite(qty)) return match;
    const scaled = qty * factor;
    if (scaled === 0) return match;
    const formatted = formatNumber(scaled);
    if (scaled === 1) return `${formatted} ${unit}`; // "2 tomatoes" → "1 tomato"
    // natural plurals for countable foods; g/ml/tbsp/tsp never inflect
    let u = unit;
    if (/(tomato|potato|chili|chilli)$/.test(u)) u = `${u}es`;
    else if (/(egg|onion|carrot|capsicum|cup|clove|slice)$/.test(u)) u = `${u}s`;
    return `${formatted} ${u}`;
  });
}
