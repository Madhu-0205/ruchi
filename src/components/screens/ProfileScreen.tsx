"use client";

import { useEffect, useMemo, useState } from "react";
import { CloudUpload, Loader2, LogOut } from "lucide-react";
import { Button, Card, Note, Pill, SectionTitle, Stat } from "@/components/ui";
import { useRuchi, streak, weeklyProgress } from "@/lib/store";
import { authAvailable, authErrorMessage, type AuthFailure } from "@/lib/auth/supabase-auth";
import { insertBetaFeedback, type FeedbackTopic } from "@/lib/auth/supabase-data";
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

type Mode = "sign-in" | "sign-up";

const FEEDBACK_TOPICS: { id: FeedbackTopic; label: string }[] = [
  { id: "recipe", label: "Recipe problem" },
  { id: "ingredients", label: "Ingredient issue" },
  { id: "instructions", label: "Instruction issue" },
  { id: "bug", label: "App bug" },
  { id: "confusing", label: "Confusing screen" },
  { id: "general", label: "General" },
];

const FEEDBACK_PLACEHOLDER: Record<FeedbackTopic, string> = {
  recipe: "Which recipe? What was wrong — quantity, time, taste?",
  ingredients: "What did the app miss or get wrong about your ingredients?",
  instructions: "Which step was unclear or didn't match reality?",
  bug: "What did you tap, and what happened instead?",
  confusing: "Which screen confused you, and what did you expect?",
  general: "Anything else — good or bad.",
};

export default function ProfileScreen() {
  const {
    name,
    setName,
    prefs,
    setPrefs,
    history,
    nudges,
    markNudgesRead,
    account,
    cloudSyncAt,
    syncError,
    authError,
    signIn,
    signUp,
    signOut,
    syncNow,
  } = useRuchi();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedbackTopic, setFeedbackTopic] = useState<FeedbackTopic>("general");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<
    "idle" | "sending" | "sent" | "error" | "unconfigured"
  >("idle");
  const configured = authAvailable();

  const week = useMemo(() => weeklyProgress({ history }), [history]);
  const currentStreak = useMemo(() => streak({ history }), [history]);
  const inventory = useRuchi((s) => s.inventory);
  const lastCookedAt = useRuchi((s) => s.lastCookedAt);
  const lastNudges = useRuchi((s) => s.lastNudges);
  const upsertNudges = useRuchi((s) => s.upsertNudges);

  const submitFeedback = async () => {
    setFeedbackStatus("sending");
    const result = await insertBetaFeedback(
      feedbackTopic,
      feedbackText,
    );
    if (result.ok) {
      setFeedbackText("");
      setFeedbackStatus("sent");
    } else {
      setFeedbackStatus(
        result.reason === "unconfigured" ? "unconfigured" : "error",
      );
    }
  };

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "sign-up") {
        const outcome = await signUp(email.trim(), password);
        if (outcome === "needs-email-confirmation") {
          setNotice(`Check ${email.trim()} to confirm your email, then sign in.`);
        }
      } else {
        await signIn(email.trim(), password);
      }
    } finally {
      setBusy(false);
    }
  };

  const authErrorCopy: Record<AuthFailure, string> = {
    "invalid-credentials": authErrorMessage("invalid-credentials"),
    "email-not-confirmed": authErrorMessage("email-not-confirmed"),
    "email-taken": authErrorMessage("email-taken"),
    "weak-password": authErrorMessage("weak-password"),
    "rate-limited": authErrorMessage("rate-limited"),
    network: authErrorMessage("network"),
    unconfigured: authErrorMessage("unconfigured"),
    error: authErrorMessage("error"),
  };

  return (
    <div className="pt-6">
      <header className="mb-6">
        <h1 className="font-display text-[30px] font-bold tracking-tight">
          {account?.displayName
            ? `Hey ${account.displayName}`
            : name
              ? `Hey ${name}`
              : "Your profile"}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {weeklySummaryLine(week.meals)}
        </p>
      </header>

      {/* Account — lightweight, appears where persistence becomes real */}
      <Card className="mb-6 p-5">
        {account ? (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold">
                  {account.displayName ?? account.email}
                </p>
                {account.email && (
                  <p className="mt-0.5 truncate text-[12px] text-muted">{account.email}</p>
                )}
                <p className="mt-0.5 text-[12px] text-muted">
                  {syncError
                    ? "Last backup didn't finish — your meals are safe on this device and will sync again."
                    : cloudSyncAt
                      ? `Backed up · ${new Date(cloudSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
                      : "Signed in — your kitchen backs up automatically."}
                </p>
              </div>
              <Pill tone={syncError ? "time" : "sage"}>
                {syncError ? "Retry pending" : "Backed up"}
              </Pill>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={syncNow} className="flex-1">
                <CloudUpload size={15} /> Back up now
              </Button>
              <Button variant="ghost" onClick={signOut}>
                <LogOut size={15} /> Sign out
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[15px] font-bold">Save your cooking progress.</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Create a free RUCHI account to keep your streak, meals and preferences safe —
              and follow you to any device.
            </p>

            {notice && (
              <div className="mt-3">
                <Note tone="sage">{notice}</Note>
              </div>
            )}
            {authError && (
              <div className="mt-3">
                <Note tone="flame">{authErrorCopy[authError]}</Note>
              </div>
            )}
            {!configured && (
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                Accounts aren&apos;t set up in this build yet — everything still works on
                this device, and your progress is saved locally.
              </p>
            )}

            {!configured ? null : (
              <form onSubmit={submit} className="mt-4 space-y-2">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-[15px] outline-none focus:border-ink/40"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "sign-up" ? "Create a password" : "Password"}
                  className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-[15px] outline-none focus:border-ink/40"
                />
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 size={15} className="animate-spin" />}
                  {mode === "sign-up" ? "Create account" : "Sign in"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === "sign-up" ? "sign-in" : "sign-up");
                  }}
                  className="w-full text-center text-[12px] text-muted hover:text-ink"
                >
                  {mode === "sign-up"
                    ? "Already have an account? Sign in"
                    : "New here? Create an account"}
                </button>
              </form>
            )}

            <p className="mt-2 text-center text-[11px] text-muted">
              You can cook everything without an account. This just backs it up.
            </p>
          </div>
        )}
      </Card>

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

      {/* Nudge inbox */}
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

      {/* Beta feedback (signed-in only) — minimal, append-only, no personal data */}
      {account && (
        <div className="mt-8">
          <SectionTitle>Beta feedback</SectionTitle>
          <Card className="p-5">
            <p className="text-sm text-muted">
              Something off? A recipe, an instruction, a confusing screen — tell us
              and it gets fixed. No personal data is collected.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {FEEDBACK_TOPICS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFeedbackTopic(t.id)}
                  className={`rounded-full border px-3 py-2 text-[13px] font-medium transition-colors ${
                    feedbackTopic === t.id
                      ? "border-ink bg-ink text-surface"
                      : "border-line text-ink hover:border-ink/40"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value.slice(0, 1000))}
              placeholder={FEEDBACK_PLACEHOLDER[feedbackTopic] ?? "Tell us what happened…"}
              rows={3}
              maxLength={1000}
              className="mt-3 w-full resize-none rounded-2xl border border-line bg-surface p-3 text-[14px] leading-relaxed outline-none focus:border-ink/50"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[12px] text-muted">
                {feedbackStatus === "sent"
                  ? "Got it — thank you. 🙏"
                  : feedbackStatus === "error"
                    ? "Couldn't send just now. Check your connection and try again."
                    : feedbackStatus === "unconfigured"
                      ? "Feedback needs a Supabase-backed account."
                      : `${feedbackText.trim().length}/1000`}
              </span>
              <Button
                onClick={submitFeedback}
                disabled={
                  feedbackStatus === "sending" ||
                  feedbackText.trim().length < 3 ||
                  feedbackText.trim().length > 1000
                }
              >
                {feedbackStatus === "sending" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  "Send"
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <p className="mb-4 mt-8 text-center text-[12px] leading-relaxed text-muted">
        RUCHI gives estimates, not medical or financial advice.
        <br />
        రుచి — let&apos;s cook. 🔥
      </p>
    </div>
  );
}
