"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
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
import { getHelp } from "@/lib/data/help";
import { getAssistantService, aiConfigured } from "@/lib/ai";
import { track } from "@/lib/engine/analytics";
import { computeCost, computeNutrition } from "@/lib/engine/nutrition";
import { scaleStepText } from "@/lib/engine/units";
import { GENERIC_QUESTIONS, fallbackAnswer } from "@/lib/engine/help-fallback";
import { RingProgress } from "@/components/ui";
import type { AiHelpAnswer } from "@/lib/data/schemas";
import type { RecipeStep } from "@/lib/types";

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
  const back = useScreen((s) => s.back);
  const go = useScreen((s) => s.go);

  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [celebrated, setCelebrated] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpBusy, setHelpBusy] = useState(false);
  const [aiHelp, setAiHelp] = useState<AiHelpAnswer | null>(null);
  const [servings, setServings] = useState(1);
  const [streakAtDone, setStreakAtDone] = useState(0);

  const recipe = recipeId ? getRecipe(recipeId) : undefined;
  const steps = recipe?.steps ?? [];
  const step: RecipeStep | undefined = steps[stepIndex];

  // Per-step timer; resets when the step changes
  const countdown = useCountdown(step?.durationMin);

  // Steps are written for 2 servings; scale quantity mentions for 1/3/4.
  const factor = servings / 2;
  const scaledText = step ? scaleStepText(step.text, factor) : "";

  useEffect(() => {
    if (recipe && stepIndex === 0) track("cooking_started", { recipeId: recipe.id });
  }, [recipe, stepIndex]);

  const nutrition = recipe ? computeNutrition(recipe, 1) : null;

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
    track("delivery_saved_metric", { recipeId: recipe.id });
    setCompleted(true);
  };

  if (!recipe) return null;

  if (completed) {
    return (
      <CompletionView
        recipeName={recipe.name}
        protein={nutrition?.protein ?? 0}
        calories={nutrition?.calories ?? 0}
        cost={computeCost(recipe, 1)}
        deliveryCost={recipe.deliveryCompare.cost}
        streakDays={streakAtDone}
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

          <AnimatePresence mode="wait">
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
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

      {/* Bottom actions — quiet zone */}
      <div className="border-t border-cream/10 bg-ink px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3.5 lg:px-8">
        <div className="mx-auto max-w-xl">
          <div className="flex gap-3">
            {stepIndex > 0 && (
              <button
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="rounded-2xl border border-cream/15 px-5 py-3 text-[15px] font-semibold text-cream/80 transition-colors hover:bg-cream/10 hover:text-cream"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                track("cooking_step_completed", { recipeId: recipe.id, step: stepIndex + 1 });
                if (isLast) finishCook();
                else setStepIndex((i) => i + 1);
              }}
              className="flex-1 rounded-2xl bg-flame px-5 py-3 text-[15px] font-bold text-white shadow-cta transition-all hover:bg-flame-deep active:scale-[0.99]"
            >
              {isLast ? "I'm done cooking 🎉" : "Next step"}
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

function CompletionView({
  recipeName,
  protein,
  calories,
  cost,
  deliveryCost,
  streakDays,
  onHome,
  onAgain,
}: {
  recipeName: string;
  protein: number;
  calories: number;
  cost: number;
  deliveryCost: number;
  streakDays: number;
  onHome: () => void;
  onAgain: () => void;
}) {
  const saved = Math.max(0, deliveryCost - cost);
  const streakLine =
    streakDays >= 2
      ? `🔥 ${streakDays} days in a row. Keep it alive tomorrow.`
      : streakDays === 1
        ? "🔥 Day one. Cook again tomorrow to start a streak."
        : null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-cream">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 12 }}
          className="text-6xl"
        >
          🎉
        </motion.div>
        <h1 className="mt-6 font-display text-display-xl font-semibold">
          That wasn&apos;t a recipe.
          <br />
          <span className="accent-italic">That was dinner.</span>
        </h1>
        <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-cream/70">
          {recipeName} — {protein}g protein, {calories} kcal, on the table by you.
        </p>

        <div className="mt-9 w-full max-w-xs rounded-3xl border border-cream/10 bg-cream/[0.08] p-5">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-cream/60">
            You didn&apos;t just cook dinner
          </p>
          <p className="mt-2 font-display text-[34px] font-semibold text-gold-soft">₹{saved} saved</p>
          <p className="mt-2 text-[13px] text-cream/60">
            vs ₹{deliveryCost} delivery. Estimated, but still yours.
          </p>
        </div>

        {streakLine && (
          <p className="mt-5 text-[14px] font-semibold text-gold-soft">{streakLine}</p>
        )}

        <button
          className="mt-8 w-full max-w-xs rounded-2xl bg-cream px-5 py-4 text-[15px] font-bold text-ink transition-colors hover:bg-white"
          onClick={onHome}
        >
          Back to my kitchen
        </button>
        <button
          onClick={onAgain}
          className="mt-3 w-full max-w-xs rounded-2xl py-3 text-[15px] font-semibold text-cream/70 transition-colors hover:text-cream"
        >
          Cook something else
        </button>
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
