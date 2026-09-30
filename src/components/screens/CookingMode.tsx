"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft,
  CircleHelp,
  Flame,
  Pause,
  Play,
  Timer,
  X,
} from "lucide-react";
import { useScreen } from "@/lib/store/screens";
import { useRuchi, computeStreak } from "@/lib/store";
import { getRecipe } from "@/lib/data/recipes";
import { findIngredient } from "@/lib/data/ingredients";
import { getHelp } from "@/lib/data/help";
import { getAssistantService, aiConfigured } from "@/lib/ai";
import { track } from "@/lib/engine/analytics";
import { computeCost, computeNutrition } from "@/lib/engine/nutrition";
import { scaleStepText } from "@/lib/engine/units";
import { GENERIC_QUESTIONS, fallbackAnswer } from "@/lib/engine/help-fallback";
import {
  minutesToDinner,
  MADE_IT_HEADLINE,
  DIDNT_ORDER_LINE,
  stepCheer,
  milestoneLine,
  reassuranceLine,
  completionEcho,
  mealNumberLine,
  completionStreakLine,
  defensibleSavings,
} from "@/lib/personality";
import { RingProgress } from "@/components/ui";
import { Celebration } from "@/components/motion";
import { FoodVisual } from "@/components/FoodVisual";
import { stepTransition, EASE } from "@/lib/motion";
import type { AiHelpAnswer } from "@/lib/data/schemas";
import type { Recipe, RecipeStep } from "@/lib/types";

function useCountdown(minutes?: number) {
  const total = (minutes ?? 0) * 60;
  // remaining initialized from the step length; remounts via key on step change
  const [remaining, setRemaining] = useState<number | null>(
    () => (minutes ? minutes * 60 : null),
  );
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r === null) return null;
        if (r <= 1) {
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [running]);

  return {
    remaining,
    running,
    total,
    start: () => {
      if (remaining === null || remaining === 0) setRemaining(total);
      setRunning(true);
    },
    pause: () => setRunning(false),
    reset: () => {
      setRemaining(total);
      setRunning(false);
    },
  };
}

export default function CookingMode() {
  const recipeId = useScreen((s) => s.recipeId);
  const screenBack = useScreen((s) => s.back);
  const go = useScreen((s) => s.go);

  // Exiting mid-recipe is a REAL paused session — the context engine may
  // offer a genuine "Resume cooking" later. Completed or step-0 exits
  // clear/park nothing (nothing meaningfully started).
  const back = () => {
    const clear = useRuchi.getState().clearPausedCooking;
    if (recipe && stepIndex > 0 && stepIndex < (recipe.steps?.length ?? 0)) {
      useRuchi.getState().pauseCookingSession(recipe.id, stepIndex, recipe.steps.length);
    } else {
      clear();
    }
    screenBack();
  };

  const [stepIndex, setStepIndex] = useState(0);
  // One idempotency token per cooking session, minted at mount — every
  // completion write (however many clicks) reuses it; the server
  // deduplicates. Consumed server-side once recorded.
  useEffect(() => {
    useRuchi.getState().beginCookingSession();
  }, []);
  const [completed, setCompleted] = useState(false);
  const [celebrated, setCelebrated] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpBusy, setHelpBusy] = useState(false);
  const [aiHelp, setAiHelp] = useState<AiHelpAnswer | null>(null);
  const [servings, setServings] = useState(1);
  const [streakAtDone, setStreakAtDone] = useState(0);
  // The real ordinal of THIS cook — server count when synced, else the
  // local record count. Both are real completion records; never fabricated.
  const [mealNumber, setMealNumber] = useState(1);
  // "I don't have this" — grounded substitution answer for the current step's
  // ingredients, sourced ONLY from the recipe's own substitution table and
  // the curated help library. No invented swaps, ever (Phase 14).
  const [subHelp, setSubHelp] = useState<string | null>(null);
  // Sparse confidence moment after completing a step (deterministic pick).
  const [cheer, setCheer] = useState<string | null>(null);
  // Completion echo — deterministic from total cook count, set once.
  const [echoLine, setEchoLine] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const recipe = recipeId ? getRecipe(recipeId) : undefined;
  const steps = recipe?.steps ?? [];
  const step: RecipeStep | undefined = steps[stepIndex];

  // Arriving with a paused session for THIS recipe resumes at the saved step;
  // anything else drops the stale pause. Done during render against the
  // *initial* step index (0) — React's adjust-state-when-props-change
  // pattern, no effect needed. `resumeKey` changes only on fresh mounts.
  const [prevResume, setPrevResume] = useState<string | null>(null);
  if (recipe && prevResume !== recipe.id) {
    setPrevResume(recipe.id);
    const paused = useRuchi.getState().pausedCooking;
    if (paused && paused.recipeId === recipe.id) {
      setStepIndex(Math.min(paused.stepIndex, steps.length - 1));
    } else if (paused) {
      useRuchi.getState().clearPausedCooking();
    }
  }

  // Per-step timer; resets when the step changes
  const countdown = useCountdown(step?.durationMin);

  // Rough time-to-dinner from this step on — the personality line's number.
  const minutesLeft = steps
    .slice(stepIndex)
    .reduce((sum, s) => sum + (s.durationMin ?? 0), 0);

  // Steps are written for 2 servings; scale quantity mentions for 1/3/4.
  const factor = servings / 2;
  const scaledText = step ? scaleStepText(step.text, factor) : "";

  useEffect(() => {
    if (recipe && stepIndex === 0) track("cooking_started", { recipeId: recipe.id });
  }, [recipe, stepIndex]);

  const nutrition = recipe ? computeNutrition(recipe, 1) : null;

  // Build a grounded, per-step "I don't have this" answer: named ingredient
  // rules from the recipe's substitution table first, then the curated
  // library's general answer. Step helpIds excluded — those are how-tos,
  // not missing-ingredient advice.
  const ingredientSubHelp = (): string | null => {
    if (!recipe || !step) return null;
    const lines = recipe.substitutions.map((s) => {
      const missingName = findIngredient(s.missingId)?.name ?? s.missingId;
      return `${missingName}: ${s.message}`;
    });
    if (lines.length === 0) return getHelp("substitute")?.answer ?? null;
    return lines.join(" ");
  };

  const openSubHelp = () => {
    if (!recipe) return;
    track("substitution_opened", { recipeId: recipe.id, step: stepIndex + 1 });
    setSubHelp(ingredientSubHelp());
  };

  const openHelp = async (question: string) => {
    setHelpOpen(true);
    if (!recipe || !step) return;
    track("recipe_help_requested", { recipeId: recipe.id, question });
    setHelpBusy(true);
    setAiHelp(null);
    let answer: AiHelpAnswer | null = null;
    if (aiConfigured()) {
      const ai = await getAssistantService().answer({
        recipeName: recipe.name,
        stepIndex,
        stepCount: steps.length,
        stepTitle: step.title,
        stepText: step.text,
        heat: step.heat,
        durationMin: step.durationMin,
        lookFor: step.lookFor,
        ingredients: recipe.ingredients.map((ri) => ri.ingredientId),
        question,
      });
      if (ai) answer = { answer: ai.answer, tone: ai.tone };
    }
    if (!answer) {
      answer = { answer: fallbackAnswer(question, recipe, step), tone: "instruct" };
    }
    setAiHelp(answer);
    setHelpBusy(false);
  };

  // Complete cook: log history + celebrate once
  const finishCook = () => {
    if (!recipe || celebrated) return;
    setCelebrated(true);
    useRuchi.getState().clearPausedCooking(); // session genuinely completed
    const n = computeNutrition(recipe, 1);
    const cost = computeCost(recipe, 1);
    useRuchi.getState().logCookedMeal({
      recipeId: recipe.id,
      recipeName: recipe.name,
      servings: 1,
      proteinG: n.protein,
      calories: n.calories,
      cost,
      deliveryCompareCost: recipe.deliveryCompare.cost,
    });
    setStreakAtDone(
      computeStreak(useRuchi.getState().history, Date.now()),
    );
    const s = useRuchi.getState();
    setMealNumber(
      s.cloudStats?.mealsCooked != null ? s.cloudStats.mealsCooked + 1 : s.history.length,
    );
    track("delivery_saved_metric", { recipeId: recipe.id });
    track("meal_completed", {
      recipeId: recipe.id,
      protein: n.protein,
      cost,
      saved: Math.max(0, recipe.deliveryCompare.cost - cost),
    });
    setEchoLine(completionEcho(useRuchi.getState().history.length));
    setCompleted(true);
  };

  if (!recipe) return null;

  if (completed) {
    return (
      <CompletionView
        recipe={recipe}
        recipeName={recipe.name}
        mealNumber={mealNumber}
        protein={nutrition?.protein ?? 0}
        calories={nutrition?.calories ?? 0}
        cost={computeCost(recipe, 1)}
        deliveryCost={recipe.deliveryCompare.cost}
        streakDays={streakAtDone}
        echo={echoLine}
        onHome={() => {
          go("home");
          setCompleted(false);
          setStepIndex(0);
          setCelebrated(false);
        }}
        onAgain={() => {
          setCompleted(false);
          setStepIndex(0);
          setCelebrated(false);
        }}
      />
    );
  }

  const isLast = stepIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-cream">
      {/* Top bar — minimal, quiet */}
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),14px)] lg:px-8">
        <button
          onClick={back}
          className="flex items-center gap-1.5 rounded-full bg-cream/10 px-3.5 py-2 text-[13px] font-semibold text-cream/80 transition-colors hover:bg-cream/15 hover:text-cream"
        >
          <ArrowLeft size={15} /> Exit
        </button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-full bg-cream/10 p-1">
            {[1, 2, 4].map((n) => (
              <button
                key={n}
                onClick={() => setServings(n)}
                className={`h-7 w-7 rounded-full text-[12px] font-bold transition-colors ${
                  servings === n ? "bg-cream text-ink" : "text-cream/60 hover:text-cream"
                }`}
                aria-label={`Cooking for ${n}`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            onClick={() => openHelp("I don't have this utensil")}
            className="rounded-full bg-cream/10 p-2 text-cream/80 transition-colors hover:bg-cream/15 hover:text-cream"
            aria-label="Help"
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-7 sm:pt-9 lg:px-8">
        <div className="mx-auto flex h-full max-w-xl flex-col">
          {/* Progress dots + count */}
          <div className="mb-5 flex items-center justify-between">
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-flame">
              Step {stepIndex + 1} of {steps.length}
            </p>
            <p className="text-[12px] font-medium text-cream/50">{recipe.name}</p>
          </div>

          {/* Progress bar */}
          <div className="mb-6 flex gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  i < stepIndex ? "bg-flame" : i === stepIndex ? "bg-flame/60" : "bg-cream/12"
                }`}
              />
            ))}
          </div>

          {/* Personality — sparse, only when there's a real estimate */}
          {minutesLeft > 0 && (
            <p className="mb-5 text-[13px] font-medium text-cream/50">
              {minutesToDinner(minutesLeft)}
            </p>
          )}

          {/* Confidence moment after the previous step — sparse, earned */}
          {cheer && (
            <motion.p
              key={cheer}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 text-[14.5px] font-semibold text-gold-soft"
              aria-live="polite"
            >
              {cheer}
            </motion.p>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={stepIndex}
              {...stepTransition}
              className="flex-1"
            >
              {step && (
                <>
                  <h1 className="font-display text-display-lg font-semibold">
                    {step.title}
                  </h1>
                  <p className="mt-4 text-[17px] leading-relaxed text-cream/90 sm:text-[19px] sm:leading-relaxed">
                    {scaledText}
                  </p>

                  {/* Heat + duration meta */}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {step.heat && step.heat !== "off" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-flame/15 px-3 py-1.5 text-[13px] font-semibold text-flame">
                        <Flame size={13} /> {step.heat} heat
                      </span>
                    )}
                    {step.durationMin ? (
                      <span className="rounded-full bg-cream/10 px-3 py-1.5 text-[13px] font-semibold text-cream/80">
                        ~{step.durationMin} min
                      </span>
                    ) : null}
                  </div>

                  {/* Timer */}
                  {step.durationMin ? (
                    <div className="mt-6 rounded-3xl border border-cream/10 bg-cream/[0.06] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <motion.div
                            {...(countdown.running &&
                            countdown.remaining !== null &&
                            countdown.remaining <= 15 &&
                            !reduceMotion
                              ? {
                                  animate: { scale: [1, 1.04, 1] },
                                  transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
                                }
                              : {})}
                          >
                            <RingProgress
                              progress={
                                countdown.remaining !== null && countdown.total > 0
                                  ? countdown.remaining / countdown.total
                                  : 0
                              }
                              size={76}
                              stroke={5}
                            >
                              <Timer size={16} className="text-flame" />
                            </RingProgress>
                          </motion.div>
                          <div>
                            <p className="text-[12px] font-semibold uppercase tracking-wide text-cream/50">
                              Suggested timer
                            </p>
                            <p className="font-display text-[32px] font-semibold tabular-nums leading-tight">
                              {formatClock(countdown.remaining)}
                            </p>
                          </div>
                        </div>
                        {countdown.running ? (
                          <button
                            onClick={countdown.pause}
                            className="flex items-center gap-1.5 rounded-2xl bg-cream px-5 py-3 text-[14px] font-bold text-ink transition-colors hover:bg-white"
                          >
                            <Pause size={15} /> Pause
                          </button>
                        ) : (
                          <button
                            onClick={countdown.start}
                            className="flex items-center gap-1.5 rounded-2xl bg-flame px-5 py-3 text-[14px] font-bold text-white shadow-cta transition-colors hover:bg-flame-deep"
                          >
                            <Play size={15} /> Start
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* LOOK FOR */}
                  <div className="mt-5 rounded-3xl border border-sage/30 bg-sage/10 p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sage">
                      Look for
                    </p>
                    <p className="mt-1.5 text-[15.5px] leading-relaxed text-cream/90">{step.lookFor}</p>
                  </div>

                  {/* "I don't have this" — grounded swaps for the current step */}
                  <button
                    onClick={openSubHelp}
                    className="mt-3 w-full rounded-3xl border border-cream/15 bg-cream/[0.05] p-4 text-left transition-colors hover:bg-cream/10"
                  >
                    <span className="flex items-center gap-2 text-[14.5px] font-semibold text-cream/90">
                      <CircleHelp size={15} className="text-cream/60" aria-hidden />
                      I don&apos;t have this
                    </span>
                    <span className="mt-1 block text-[12.5px] text-cream/55">
                      See what works instead — swaps come from this recipe only.
                    </span>
                  </button>

                  {/* Safety */}
                  {step.safety && (
                    <div className="mt-3 rounded-3xl border border-flame/30 bg-flame/10 p-5">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-flame">
                        Safety
                      </p>
                      <p className="mt-1.5 text-[14.5px] leading-relaxed text-cream/90">
                        {step.safety}
                      </p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom actions — quiet zone, floating glass-dark chrome */}
      <div className="glass-dark border-t border-cream/10 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3.5 lg:px-8">
        <div className="mx-auto max-w-xl">
          <div className="flex gap-3">
            {stepIndex > 0 && (
              <button
                onClick={() => {
                setCheer(null);
                setStepIndex((i) => Math.max(0, i - 1));
              }}
                className="rounded-2xl border border-cream/15 px-5 py-3 text-[15px] font-semibold text-cream/80 transition-colors hover:bg-cream/10 hover:text-cream"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                track("cooking_step_completed", { recipeId: recipe.id, step: stepIndex + 1 });
                if (isLast) {
                  finishCook();
                } else {
                  const next = stepIndex + 1;
                  setStepIndex(next);
                  // Confidence moments: midpoint milestone first, else the
                  // every-3rd-step cheer. Cleared when moving backward.
                  setCheer(milestoneLine(next, steps.length) ?? stepCheer(next));
                }
              }}
              className="flex-1 rounded-2xl bg-flame px-5 py-3 text-[15px] font-bold text-white shadow-cta transition-all hover:bg-flame-deep active:scale-[0.99]"
            >
              {isLast ? "I made it 🎉" : "Next →"}
            </button>
            {!isLast && (
              <button
                onClick={finishCook}
                className="rounded-2xl border border-cream/15 px-5 py-3 text-[15px] font-semibold text-cream/80 transition-colors hover:bg-cream/10 hover:text-cream"
              >
                Done
              </button>
            )}
          </div>
          <button
            onClick={() => openHelp("How do I know it's ready?")}
            className="mt-2.5 w-full rounded-2xl py-2 text-[13.5px] font-semibold text-flame transition-colors hover:text-flame/80"
          >
            How do I know it&apos;s ready?
          </button>
        </div>
      </div>

      {/* "I don't have this" sheet — recipe's own substitution table only */}
      <AnimatePresence>
        {subHelp && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-end bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSubHelp(null)}
          >
            <motion.div
              className="w-full rounded-t-3xl bg-ink border-t border-cream/15 p-5 pb-[max(env(safe-area-inset-bottom),20px)] text-cream"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-[17px] font-bold">Don&apos;t have it?</h3>
                  <p className="mt-0.5 text-[13px] text-cream/60">
                    Here are the swaps from this recipe.
                  </p>
                </div>
                <button
                  onClick={() => setSubHelp(null)}
                  aria-label="Close substitutions"
                  className="p-1 text-cream/60 hover:text-cream"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="rounded-2xl bg-cream/[0.06] p-4">
                <p className="text-[15px] leading-relaxed">{subHelp}</p>
                <p className="mt-2 text-[12px] text-cream/50">
                  Swaps from this recipe only — RUCHI won&apos;t guess with your dinner.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help sheet */}
      <AnimatePresence>
        {helpOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-end bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setHelpOpen(false)}
          >
            <motion.div
              className="max-h-[75dvh] w-full overflow-y-auto rounded-t-3xl bg-ink border-t border-cream/15 p-5 pb-[max(env(safe-area-inset-bottom),20px)] text-cream"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[17px] font-bold">While you cook</h3>
                <button
                  onClick={() => setHelpOpen(false)}
                  aria-label="Close help"
                  className="p-1 text-cream/60 hover:text-cream"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(step?.helpIds ?? []).map((id) => {
                  const h = getHelp(id);
                  return h ? (
                    <button
                      key={id}
                      onClick={() => openHelp(h.question)}
                      className="rounded-full border border-cream/15 bg-cream/5 px-3.5 py-2 text-[13px] font-semibold text-cream/90"
                    >
                      {h.question}
                    </button>
                  ) : null;
                })}
                {GENERIC_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => openHelp(q)}
                    className="rounded-full border border-cream/15 bg-cream/5 px-3.5 py-2 text-[13px] font-semibold text-cream/90"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-cream/[0.06] p-4">
                {helpBusy ? (
                  <p className="text-[15px] text-cream/60">Thinking…</p>
                ) : aiHelp ? (
                  <>
                    <p className="text-[15px] leading-relaxed">{aiHelp.answer}</p>
                    {/* Mistake-handling footer: lowers the stakes at the exact
                        "am I doing this right?" moment. */}
                    <p className="mt-2.5 border-t border-cream/10 pt-2.5 text-[13px] text-cream/60">
                      {reassuranceLine(stepIndex)}
                    </p>
                    <p className="mt-2 text-[12px] text-cream/50">
                      {aiConfigured() ? "AI-assisted" : "RUCHI's kitchen notes"} · estimates, not gospel
                    </p>
                  </>
                ) : (
                  <p className="text-[15px] text-cream/60">
                    Ask anything about this step — tap a question above.
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Completion view ─────────────────────────────────────────

// ── Completion view — "The Record" ──────────────────────────
// A full-bleed dark stage, one light source, and the real meal
// number as the hero. Every element enters in one quiet sequence;
// prefers-reduced-motion gets the same composition, instantly.

function CompletionView({
  recipe,
  recipeName,
  mealNumber,
  protein,
  calories,
  cost,
  deliveryCost,
  streakDays,
  echo,
  onHome,
  onAgain,
}: {
  recipe: Recipe;
  recipeName: string;
  mealNumber: number;
  protein: number;
  calories: number;
  cost: number;
  deliveryCost: number;
  streakDays: number;
  echo: string | null;
  onHome: () => void;
  onAgain: () => void;
}) {
  const reduceMotion = useReducedMotion();
  // Savings render ONLY when the comparison is defensible: a real catalog
  // delivery price that actually beats the cooked cost. Otherwise silence.
  const saved = defensibleSavings(cost, deliveryCost);
  const showSavings = saved != null;
  // A zero streak says nothing at all — never "0 day streak".
  const streakLine = completionStreakLine(streakDays);

  // One quiet entrance per layer — a poster, not an animation demo.
  const enter = (delay: number) =>
    reduceMotion
      ? false
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, ease: EASE, delay },
        };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink text-cream">
      {/* The stage: a single warm light behind the numeral, a soft floor
          vignette. Depth from light, not from decoration. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(58% 46% at 50% 40%, rgb(185 127 16 / 0.18), transparent 72%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 115%, transparent 52%, rgb(6 6 8 / 0.55))",
          }}
        />
      </div>

      <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
        {/* The one restrained celebratory moment — soft bloom, then quiet. */}
        <Celebration active />

        {/* The dish — supporting cast, gently present. */}
        <motion.div
          initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? undefined : { type: "spring", damping: 16, delay: 0.05 }}
        >
          <motion.div
            animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
            transition={
              reduceMotion ? undefined : { duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: 1 }
            }
            className="rounded-full shadow-lifted ring-1 ring-cream/10"
          >
            <FoodVisual
              recipe={recipe}
              emojiClassName="text-5xl"
              className="h-24 w-24 rounded-full"
            />
          </motion.div>
        </motion.div>

        <motion.p
          {...enter(0.15)}
          className="mt-5 text-[12px] font-bold uppercase tracking-[0.28em] text-cream/50"
        >
          {MADE_IT_HEADLINE}
        </motion.p>
        <motion.p
          {...enter(0.22)}
          className="mt-2 font-display text-[26px] font-semibold leading-snug"
        >
          {recipeName}
        </motion.p>
        <motion.p {...enter(0.28)} className="mt-1 text-[14px] font-medium text-cream/55">
          {protein}g protein · {calories} kcal
        </motion.p>

        {/* THE HERO — the real meal number. It is a record that actually
            exists: server count when synced, else the real local count. */}
        <motion.p
          initial={
            reduceMotion
              ? false
              : { opacity: 0, scale: 0.94, filter: "blur(12px)" }
          }
          animate={
            reduceMotion
              ? undefined
              : { opacity: 1, scale: 1, filter: "blur(0px)" }
          }
          transition={reduceMotion ? undefined : { duration: 0.85, ease: EASE, delay: 0.34 }}
          className="mt-4 bg-gradient-to-b from-cream via-cream to-gold-soft bg-clip-text font-display text-[104px] font-semibold leading-none tracking-tight text-transparent sm:text-[136px]"
        >
          {mealNumber}
        </motion.p>
        <motion.p {...enter(0.55)} className="mt-3 text-[14px] font-medium text-cream/60">
          {mealNumberLine(mealNumber)}
        </motion.p>

        {/* The honest math — one line, only when the comparison is defensible. */}
        {showSavings && (
          <motion.p {...enter(0.62)} className="mt-6 text-[15px] font-semibold text-gold-soft">
            ₹{saved} estimated saved.
            <span className="ml-2 text-[12px] font-medium text-cream/40">
              Estimates, not invoices.
            </span>
          </motion.p>
        )}

        <motion.p
          {...enter(0.7)}
          className="mt-6 max-w-xs whitespace-pre-line text-[15px] font-semibold leading-relaxed text-cream/90"
        >
          {DIDNT_ORDER_LINE}
        </motion.p>

        {streakLine && (
          <motion.p {...enter(0.76)} className="mt-3 text-[14px] font-semibold text-gold-soft">
            {streakLine}
          </motion.p>
        )}
        {echo && (
          <motion.p {...enter(0.8)} className="mt-3 text-[14.5px] font-medium text-cream/70">
            {echo}
          </motion.p>
        )}

        <motion.div {...enter(0.88)} className="mt-9 w-full max-w-xs">
          <button
            className="w-full rounded-2xl bg-cream px-5 py-4 text-[15px] font-bold text-ink transition-colors hover:bg-white active:scale-[0.99]"
            onClick={onAgain}
          >
            Ready for another one?
          </button>
          <button
            onClick={onHome}
            className="mt-3 w-full rounded-2xl py-3 text-[15px] font-semibold text-cream/70 transition-colors hover:text-cream"
          >
            Back to kitchen
          </button>
        </motion.div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function formatClock(sec: number | null): string {
  if (sec === null) return "—:—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// paletteFor imported above — keeps the dark room visually tied to the dish.
