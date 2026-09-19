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
import { Button, Card, Pill } from "@/components/ui";
import { useScreen } from "@/lib/store/screens";
import { useRuchi, computeStreak } from "@/lib/store";
import { getRecipe } from "@/lib/data/recipes";
import { getHelp } from "@/lib/data/help";
import { getAssistantService, aiConfigured } from "@/lib/ai";
import { track } from "@/lib/engine/analytics";
import { computeCost, computeNutrition } from "@/lib/engine/nutrition";
import { scaleStepText } from "@/lib/engine/units";
import { GENERIC_QUESTIONS, fallbackAnswer } from "@/lib/engine/help-fallback";
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
    <div className="fixed inset-0 z-50 flex flex-col bg-cream">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),14px)]">
        <button
          onClick={back}
          className="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-2 text-[13px] font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft size={15} /> Exit
        </button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-white/70 p-1">
            {[1, 2, 4].map((n) => (
              <button
                key={n}
                onClick={() => setServings(n)}
                className={`h-7 w-7 rounded-full text-[12px] font-bold transition-colors ${
                  servings === n ? "bg-ink text-cream" : "text-muted hover:text-ink"
                }`}
                aria-label={`Cooking for ${n}`}
              >
                {n === 4 ? "4" : n}
              </button>
            ))}
          </div>
          <button
            onClick={() => openHelp("I don't have this utensil")}
            className="rounded-full bg-white/70 p-2 text-muted hover:text-ink"
            aria-label="Help"
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-flame transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={stepIndex}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18 }}
          >
            {step && (
              <>
                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-flame">
                  Step {stepIndex + 1} · {recipe.name}
                </p>
                <h1 className="mt-2 font-display text-[28px] font-bold leading-tight">
                  {step.title}
                </h1>
                <p className="mt-3 text-[17px] leading-relaxed">{scaledText}</p>

                {/* Heat + duration meta */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {step.heat && step.heat !== "off" && (
                    <Pill tone="time">
                      <Flame size={12} /> {step.heat} flame
                    </Pill>
                  )}
                  {step.durationMin ? (
                    <Pill>~{step.durationMin} min</Pill>
                  ) : null}
                </div>

                {/* Timer */}
                {step.durationMin ? (
                  <Card className="mt-4 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-flame-soft">
                          <Timer size={20} className="text-flame-deep" />
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-muted">Suggested timer</p>
                          <p className="text-2xl font-bold tabular-nums">
                            {formatClock(countdown.remaining)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {countdown.running ? (
                          <button
                            onClick={countdown.pause}
                            className="rounded-2xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-cream"
                          >
                            <Pause size={15} className="mr-1 inline" /> Pause
                          </button>
                        ) : (
                          <button
                            onClick={countdown.start}
                            className="rounded-2xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-cream"
                          >
                            <Play size={15} className="mr-1 inline" /> Start
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                ) : null}

                {/* LOOK FOR */}
                <div className="mt-4 rounded-2xl border border-sage/25 bg-sage-soft p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sage">
                    Look for
                  </p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-sage">{step.lookFor}</p>
                </div>

                {/* Safety */}
                {step.safety && (
                  <div className="mt-3 rounded-2xl border border-flame/25 bg-flame-soft p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-flame-deep">
                      Safety
                    </p>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-flame-deep">
                      {step.safety}
                      </p>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom actions */}
      <div className="border-t border-line bg-cream px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
        <div className="flex gap-3">
          {stepIndex > 0 && (
            <Button variant="secondary" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
              Back
            </Button>
          )}
          <Button
            className="flex-1"
            onClick={() => {
              track("cooking_step_completed", { recipeId: recipe.id, step: stepIndex + 1 });
              if (isLast) finishCook();
              else setStepIndex((i) => i + 1);
            }}
          >
            {isLast ? "I'm done cooking 🎉" : "Next step"}
          </Button>
          {!isLast && (
            <Button variant="secondary" onClick={finishCook}>
              Done
            </Button>
          )}
        </div>
        <button
          onClick={() => openHelp("How do I know it's ready?")}
          className="mt-2 w-full rounded-2xl py-2 text-[14px] font-semibold text-flame"
        >
          How do I know it&apos;s ready?
        </button>
      </div>

      {/* Help sheet */}
      <AnimatePresence>
        {helpOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-end bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setHelpOpen(false)}
          >
            <motion.div
              className="max-h-[75dvh] w-full overflow-y-auto rounded-t-3xl bg-cream p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
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
                  className="p-1 text-muted"
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
                      className="rounded-full border border-line bg-white px-3.5 py-2 text-[13px] font-semibold"
                    >
                      {h.question}
                    </button>
                  ) : null;
                })}
                {GENERIC_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => openHelp(q)}
                    className="rounded-full border border-line bg-white px-3.5 py-2 text-[13px] font-semibold"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-white p-4">
                {helpBusy ? (
                  <p className="text-[15px] text-muted">Thinking…</p>
                ) : aiHelp ? (
                  <>
                    <p className="text-[15px] leading-relaxed">{aiHelp.answer}</p>
                    <p className="mt-2 text-[12px] text-muted">
                      {aiConfigured() ? "AI-assisted" : "RUCHI's kitchen notes"} · estimates, not gospel
                    </p>
                  </>
                ) : (
                  <p className="text-[15px] text-muted">
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
        <h1 className="mt-6 font-display text-[30px] font-bold leading-tight">
          That wasn&apos;t a recipe.
          <br />
          That was dinner.
        </h1>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-cream/70">
          {recipeName} — {protein}g protein, {calories} kcal, on the table by you.
        </p>

        <div className="mt-8 w-full max-w-xs rounded-3xl bg-white/10 p-5">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-cream/60">
            You didn&apos;t just cook dinner
          </p>
          <p className="mt-2 text-3xl font-bold text-gold-soft">₹{saved} saved</p>
          <p className="mt-2 text-[13px] text-cream/60">
            vs ₹{deliveryCost} delivery. Estimated, but still yours.
          </p>
        </div>

        {streakLine && (
          <p className="mt-5 text-[14px] font-semibold text-gold-soft">{streakLine}</p>
        )}

        <Button
          className="mt-8 w-full max-w-xs bg-cream text-ink hover:bg-white"
          onClick={onHome}
        >
          Back to my kitchen
        </Button>
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

// ── Help fallback lives in lib/engine/help-fallback.ts (pure + tested) ──
