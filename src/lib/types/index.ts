// ─────────────────────────────────────────────────────────────
// RUCHI — shared domain types
// ─────────────────────────────────────────────────────────────
// "రుచి" = Cook / Let's cook

export type DietTag = "veg" | "egg" | "nonveg";

export type Unit =
  | "count"
  | "g"
  | "ml"
  | "tbsp"
  | "tsp"
  | "cup"
  | "clove"
  | "packet";

export type IngredientCategory =
  | "vegetable"
  | "protein"
  | "grain"
  | "dairy"
  | "spice"
  | "pantry"
  | "fat"
  | "condiment";

export type ProteinSource = "egg" | "paneer" | "chicken" | "legume" | "dairy" | "soy";

export type Intent =
  | "high-protein"
  | "healthy"
  | "quick"
  | "budget"
  | "comfort"
  | "spicy";

/** Meal slot — drives Discover sections and search. */
export type RecipeCategory = "breakfast" | "lunch" | "dinner" | "snack" | "drink";

export type Equipment = "stove" | "kadai" | "pan" | "pot" | "pressure_cooker" | "oven" | "microwave" | "none";

export type HeatLevel = "off" | "low" | "medium-low" | "medium" | "medium-high" | "high";

export type Storage = "pantry" | "fridge" | "freezer";

export type DietPreference = "vegetarian" | "eggetarian" | "non-vegetarian";

export type FitnessGoal = "none" | "high-protein" | "weight-loss" | "lean-bulk";

export type SkillLevel = "beginner" | "comfortable" | "confident";

export type BudgetPerMeal = 50 | 100 | 150 | 200;

export type TimeRange = 10 | 15 | 30 | 45;

export type People = 1 | 2 | 3 | 4;

export interface Nutrition {
  calories: number; // kcal, per serving
  protein: number; // g, per serving
  carbs: number; // g
  fat: number; // g
  fiber?: number; // g, only when reliable
}

export interface Ingredient {
  id: string;
  name: string; // display name, English
  aliases: string[]; // search terms incl. Telugu/Hindi common names
  category: IngredientCategory;
  // Reference nutrition per 100 g/ml (count items normalized by avg piece weight)
  nutritionPer100: { kcal: number; protein: number; carbs: number; fat: number; fiber?: number };
  avgPieceG?: number; // for count-based items
  costPer100: number; // ₹ per 100g/ml, Indian metro pricing
  tags: ("high-protein" | "expires-fast" | "pantry-stable")[];
}

export interface RecipeIngredient {
  ingredientId: string;
  qty: number; // for 2 servings baseline
  unit: Unit;
  scalable: boolean; // spices/oil don't always scale 1:1 (use 0.75 factor)
  optional?: boolean;
}

export interface RecipeStep {
  id: string;
  title: string; // imperative short summary
  text: string; // full instruction with exact quantities
  heat?: HeatLevel;
  durationMin?: number; // active-ish time for timer suggestion
  lookFor: string; // the visual/observable done-cue
  safety?: string; // explicit food-safety note when relevant
  helpIds?: string[]; // contextual help topics for this step
}

export interface Recipe {
  id: string;
  name: string;
  teluguName?: string;
  description: string; // one-liner, RUCHI voice
  cuisine: string;
  diet: DietTag;
  category: RecipeCategory; // meal slot (breakfast/lunch/dinner/snack/drink)
  heroEmoji: string; // no external images in MVP
  timeMin: number; // total, includes prep
  difficulty: "easy" | "medium";
  servings: number; // baseline the ingredient quantities are written for (always 2)
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  nutritionPerServing: Nutrition;
  tags: Intent[]; // which intents this recipe satisfies
  proteinSource?: ProteinSource;
  equipment: Equipment[];
  beginnerTips: string[];
  substitutions: SubstitutionRule[];
  deliveryCompare: { name: string; cost: number }; // what ordering this would cost
}

export interface SubstitutionRule {
  missingId: string;
  message: string; // beginner-friendly swap guidance
  useId?: string;
  qty?: number;
  unit?: Unit;
}

export interface UserPreferences {
  diet: DietPreference;
  allergies: string[];
  fitnessGoal: FitnessGoal;
  skill: SkillLevel;
  defaultServings: People;
  budget: BudgetPerMeal;
  cuisines: string[];
  equipment: Equipment[];
}

export interface KitchenItem {
  id: string; // instance id
  ingredientId: string;
  addedAt: number; // epoch ms
  expiresAt?: number; // epoch ms, optional
  qtyKnown?: boolean; // MVP: track presence, not quantity
}

export interface NudgeEvent {
  id: string;
  kind: NudgeKind;
  title: string;
  body: string;
  ctaRoute?: string;
  createdAt: number;
  read: boolean;
}

export type NudgeKind =
  | "morning-ingredient"
  | "evening-dinner"
  | "after-cook"
  | "habit"
  | "expiry"
  | "comeback";

// ── Analytics ───────────────────────────────────────────────
export type AnalyticsEventName =
  | "ingredient_added"
  | "meal_recommendation_viewed"
  | "meal_selected"
  | "cooking_started"
  | "cooking_step_completed"
  | "cooking_completed"
  | "meal_saved"
  | "ingredient_substituted"
  | "recipe_help_requested"
  | "meal_shared"
  | "notification_opened"
  | "delivery_saved_metric"; // intended-delivery → cooked conversion metric

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  props?: Record<string, string | number | boolean>;
  ts: number;
}

// ── Session/history ─────────────────────────────────────────
export interface MealHistoryEntry {
  id: string;
  recipeId: string;
  recipeName: string;
  cookedAt: number;
  servings: number;
  proteinG: number;
  calories: number;
  cost: number;
  deliveryCompareCost: number;
}

export interface WeeklyProgress {
  meals: number;
  saved: number;
  protein: number;
  streak: number;
}
