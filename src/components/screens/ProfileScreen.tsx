"use client";

import { useEffect, useMemo } from "react";
import { Card, Pill, SectionTitle, Stat } from "@/components/ui";
import { useRuchi, streak, weeklyProgress } from "@/lib/store";
import { buildNudges, weeklySummaryLine } from "@/lib/engine/nudge";
import type {
  BudgetPerMeal,
  DietPreference,
  FitnessGoal,
  NudgeKind,
  People,
  SkillLevel,
} from "@/lib/types";

const DIETS: { id: DietPreference; label: string }[] = [
  { id: "vegetarian", label: "🥬 Veg" },
  { id: "eggetarian", label: "🥚 Eggetarian" },
  { id: "non-vegetarian", label: "🍗 Non-veg" },
];

const SKILLS: { id: SkillLevel; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "comfortable", label: "Comfortable" },
  { id: "confident", label: "Confident" },
];

const GOALS: { id: FitnessGoal; label: string }[] = [
  { id: "none", label: "Just eating" },
  { id: "high-protein", label: "💪 High protein" },
  { id: "weight-loss", label: "⚖️ Lighter meals" },
  { id: "lean-bulk", label: "🏋️ Lean bulk" },
];

export default function ProfileScreen() {
  const {
    name,
    setName,
    prefs,
    setPrefs,
    history,
    nudges,
    markNudgesRead,
  } = useRuchi();

  const week = useMemo(() => weeklyProgress({ history }), [history]);
  const currentStreak = useMemo(() => streak({ history }), [history]);
  const inventory = useRuchi((s) => s.inventory);
  const lastCookedAt = useRuchi((s) => s.lastCookedAt);
  const lastNudges = useRuchi((s) => s.lastNudges);
  const upsertNudges = useRuchi((s) => s.upsertNudges);

  // Nudge inbox: generated once per visit; cooldowns live in buildNudges.
  useEffect(() => {
    const now = Date.now();
    const inbox = buildNudges({
      now,
      inventoryNames: inventory.map((i) => i.ingredientId),
      expiringSoonNames: inventory
        .filter((i) => i.expiresAt && i.expiresAt - now < 2 * 86400000)
        .map(() => "an item"),
      hasCookedBefore: history.length > 0,
      mealsThisWeek: week.meals,
      savedThisWeek: week.saved,
      lastCookedAt,
      lastNudges: (lastNudges ?? {}) as Record<NudgeKind, number>,
    });
    if (inbox.length > 0) upsertNudges(inbox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unread = nudges.filter((n) => !n.read).length;
    if (unread > 0) markNudgesRead();
  }, [nudges, markNudgesRead]);

  return (
    <div className="pt-6">
      <header className="mb-6">
        <h1 className="font-display text-[30px] font-bold tracking-tight">
          {name ? `Hey ${name}` : "Your profile"}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {weeklySummaryLine(week.meals)}
        </p>
      </header>

      {/* Progress */}
      <Card className="p-5">
        <SectionTitle>This week</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <Stat value={week.meals} label="meals cooked" />
          <Stat value={`₹${week.saved}`} label="saved (est.)" tone="savings" />
          <Stat value={`${week.protein}g`} label="protein" tone="protein" />
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <Pill tone="time">🔥 {currentStreak} day streak</Pill>
          <span className="text-[12px] text-muted">
            {currentStreak >= 3
              ? "You're doing this for real."
              : "Cook tomorrow to grow the streak."}
          </span>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Savings estimated from ingredient costs vs typical delivery prices. Not a bank statement.
        </p>
      </Card>

      {/* Nudge inbox (notification architecture preview) */}
      {nudges.length > 0 && (
        <div className="mt-6">
          <SectionTitle>For you</SectionTitle>
          <div className="space-y-2">
            {nudges.slice(0, 3).map((n) => (
              <Card key={n.id} className="p-4">
                <p className="text-[14px] font-semibold">{n.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{n.body}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Preferences */}
      <div className="mt-8 space-y-6">
        <div>
          <SectionTitle>Name</SectionTitle>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should we call you?"
            className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-[15px] outline-none focus:border-ink/40"
          />
        </div>

        <div>
          <SectionTitle>Diet</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {DIETS.map((d) => (
              <button
                key={d.id}
                onClick={() => setPrefs({ diet: d.id })}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  prefs.diet === d.id
                    ? "bg-ink text-cream"
                    : "border border-line bg-white text-ink"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle>Cooking skill</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                onClick={() => setPrefs({ skill: s.id })}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  prefs.skill === s.id
                    ? "bg-ink text-cream"
                    : "border border-line bg-white text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle>Fitness goal</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <button
                key={g.id}
                onClick={() => setPrefs({ fitnessGoal: g.id })}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  prefs.fitnessGoal === g.id
                    ? "bg-ink text-cream"
                    : "border border-line bg-white text-ink"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle>Default servings</SectionTitle>
          <div className="flex gap-2">
            {([1, 2, 3, 4] as People[]).map((p) => (
              <button
                key={p}
                onClick={() => setPrefs({ defaultServings: p })}
                className={`h-11 flex-1 rounded-2xl border text-[15px] font-semibold ${
                  prefs.defaultServings === p
                    ? "border-ink bg-ink text-cream"
                    : "border-line bg-white"
                }`}
              >
                {p === 4 ? "4+" : p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle>Budget per meal</SectionTitle>
          <div className="flex gap-2">
            {([50, 100, 150, 200] as BudgetPerMeal[]).map((b) => (
              <button
                key={b}
                onClick={() => setPrefs({ budget: b })}
                className={`h-11 flex-1 rounded-2xl border text-[15px] font-semibold ${
                  prefs.budget === b ? "border-ink bg-ink text-cream" : "border-line bg-white"
                }`}
              >
                ₹{b === 200 ? "200+" : b}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recent meals */}
      <div className="mt-8">
        <SectionTitle>Recent meals</SectionTitle>
        {history.length === 0 ? (
          <Card className="p-5">
            <p className="text-[15px] font-semibold">Nothing cooked yet.</p>
            <p className="mt-1 text-sm text-muted">
              The first one is the hardest. After that it&apos;s just dinner.
            </p>
          </Card>
          ) : (
          <div className="space-y-2">
            {history.slice(0, 8).map((h) => (
              <Card key={h.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[15px] font-semibold">{h.recipeName}</p>
                    <p className="text-[12px] text-muted">
                      {new Date(h.cookedAt).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      · {h.servings} serving{h.servings > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14px] font-bold text-sage">{h.proteinG}g protein</p>
                    <p className="text-[12px] text-gold">
                      saved ~₹{Math.max(0, h.deliveryCompareCost - h.cost)}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <p className="mb-4 mt-8 text-center text-[12px] leading-relaxed text-muted">
        RUCHI gives estimates, not medical or financial advice.
        <br />
        రుచి — let&apos;s cook. 🔥
      </p>
    </div>
  );
}
