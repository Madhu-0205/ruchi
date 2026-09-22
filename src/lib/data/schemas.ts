import { z } from "zod";
import type {
  Ingredient,
  Nutrition,
  Recipe,
  RecipeIngredient,
  RecipeStep,
  SubstitutionRule,
} from "@/lib/types";

// Zod mirrors of the domain types. Used to validate:
//  1. the curated dataset at import time (fail fast in dev/build)
//  2. every structured AI response (reject malformed payloads)

export const nutritionSchema = z.object({
  calories: z.number().min(0).max(2000),
  protein: z.number().min(0).max(150),
  carbs: z.number().min(0).max(300),
  fat: z.number().min(0).max(150),
  fiber: z.number().min(0).max(80).optional(),
}) satisfies z.ZodType<Nutrition>;

export const ingredientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  category: z.enum([
    "vegetable",
    "protein",
    "grain",
    "dairy",
    "spice",
    "pantry",
    "fat",
    "condiment",
  ]),
  nutritionPer100: z.object({
    kcal: z.number().min(0).max(950),
    protein: z.number().min(0).max(95),
    carbs: z.number().min(0).max(100),
    fat: z.number().min(0).max(100),
    fiber: z.number().min(0).max(95).optional(),
  }),
  avgPieceG: z.number().positive().optional(),
  costPer100: z.number().min(0).max(1200),
  tags: z.array(z.enum(["high-protein", "expires-fast", "pantry-stable"])),
}) satisfies z.ZodType<Ingredient>;

export const recipeIngredientSchema = z.object({
  ingredientId: z.string().min(1),
  qty: z.number().positive().max(5000),
  unit: z.enum(["count", "g", "ml", "tbsp", "tsp", "cup", "clove", "packet"]),
  scalable: z.boolean(),
  optional: z.boolean().optional(),
}) satisfies z.ZodType<RecipeIngredient>;

export const recipeStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  text: z.string().min(1),
  heat: z
    .enum(["off", "low", "medium-low", "medium", "medium-high", "high"])
    .optional(),
  durationMin: z.number().min(0).max(120).optional(),
  lookFor: z.string().min(1),
  safety: z.string().optional(),
  helpIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<RecipeStep>;

export const substitutionRuleSchema = z.object({
  missingId: z.string().min(1),
  message: z.string().min(1),
  useId: z.string().optional(),
  qty: z.number().positive().optional(),
  unit: z
    .enum(["count", "g", "ml", "tbsp", "tsp", "cup", "clove", "packet"])
    .optional(),
}) satisfies z.ZodType<SubstitutionRule>;

export const recipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  teluguName: z.string().optional(),
  description: z.string().min(1),
  cuisine: z.string().min(1),
  diet: z.enum(["veg", "egg", "nonveg"]),
  category: z.enum(["breakfast", "lunch", "dinner", "snack", "drink"]),
  heroEmoji: z.string().min(1),
  timeMin: z.number().int().min(5).max(120),
  difficulty: z.enum(["easy", "medium"]),
  servings: z.literal(2), // dataset baseline is always 2 servings
  ingredients: z.array(recipeIngredientSchema).min(2),
  steps: z.array(recipeStepSchema).min(3).max(14),
  nutritionPerServing: nutritionSchema,
  tags: z.array(
    z.enum([
      "high-protein",
      "healthy",
      "quick",
      "budget",
      "comfort",
      "spicy",
    ]),
  ),
  proteinSource: z
    .enum([
      "egg",
      "paneer",
      "chicken",
      "mutton",
      "fish",
      "seafood",
      "legume",
      "dairy",
      "soy",
    ])
    .optional(),
  equipment: z.array(
    z.enum([
      "stove",
      "kadai",
      "pan",
      "pot",
      "pressure_cooker",
      "oven",
      "microwave",
      "none",
    ]),
  ),
  beginnerTips: z.array(z.string()),
  substitutions: z.array(substitutionRuleSchema),
  deliveryCompare: z.object({ name: z.string(), cost: z.number().min(0) }),
}) satisfies z.ZodType<Recipe>;

// ── AI response contracts ───────────────────────────────────

export const aiHelpAnswerSchema = z.object({
  answer: z.string().min(1).max(600),
  tone: z.enum(["reassure", "instruct", "rescue"]),
  relatedStepHint: z.string().optional(),
});
export type AiHelpAnswer = z.infer<typeof aiHelpAnswerSchema>;

export const aiRecommendationSchema = z.object({
  recipeIds: z.array(z.string().min(1)).min(1).max(4),
  lines: z.array(z.string()).optional(), // one microcopy line per recommendation
});
export type AiRecommendation = z.infer<typeof aiRecommendationSchema>;
