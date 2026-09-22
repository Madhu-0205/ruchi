"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Camera,
  Check,
  ImageIcon,
  Keyboard,
  Plus,
  RotateCcw,
  ScanLine,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button, Card, Chip, Note, SectionTitle } from "@/components/ui";
import { useScreen } from "@/lib/store/screens";
import { useRuchi } from "@/lib/store";
import { INGREDIENTS, findIngredient } from "@/lib/data/ingredients";
import { parseIngredientText } from "@/lib/engine/parse";
import { track } from "@/lib/engine/analytics";
import { getVisionService, prepareImageForVision } from "@/lib/ai";
import type { VisionAnalysis } from "@/lib/ai";
import type { Intent } from "@/lib/types";

// ── Flow states ─────────────────────────────────────────────
// capture → analyzing → confirm → (home with recommendations)
type Phase = "capture" | "analyzing" | "confirm" | "text";

interface ConfirmItem {
  key: string; // stable row key
  id?: string; // catalog id when confidently matched
  name: string;
  quantity?: string;
  uncertain: boolean;
}

const GOAL_CHIPS: { id: Intent | "filling"; label: string }[] = [
  { id: "high-protein", label: "💪 High Protein" },
  { id: "quick", label: "⚡ Under 15 min" },
  { id: "budget", label: "💰 Under ₹100" },
  { id: "healthy", label: "🥗 Healthy" },
];

const ANALYZING_LINES = [
  "Looking through your kitchen...",
  "Finding what you can make...",
  "Counting the eggs...",
  "Checking what's ripe...",
  "Almost there...",
];

function emojiFor(idOrName: string): string {
  const ing = findIngredient(idOrName) ?? INGREDIENTS.find((i) => i.name === idOrName);
  const map: Record<string, string> = {
    egg: "🥚", paneer: "🧀", tomato: "🍅", onion: "🧅", potato: "🥔",
    rice: "🍚", bread: "🍞", curd: "🥛", milk: "🥛", carrot: "🥕",
    "green-chili": "🌶️", capsicum: "🫑", lemon: "🍋", "chicken-breast": "🍗",
    "coriander-leaves": "🌿", spinach: "🥬", cabbage: "🥬", peas: "🫛",
    "spring-onion": "🧅", garlic: "🧄", ginger: "🫚", butter: "🧈",
    "toor-dal": "🟡", "moong-dal": "🟢", oats: "🥣", poha: "🍚", atta: "🌾",
  };
  return map[ing?.id ?? idOrName] ?? "🥘";
}

export default function ScanScreen() {
  const back = useScreen((s) => s.back);
  const go = useScreen((s) => s.go);
  const addItem = useRuchi((s) => s.addItem);

  const [phase, setPhase] = useState<Phase>("capture");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [items, setItems] = useState<ConfirmItem[]>([]);
  const [analysisLine, setAnalysisLine] = useState(0);
  const [goals, setGoals] = useState<string[]>(["high-protein"]);
  const [textValue, setTextValue] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const visionAbortRef = useRef<AbortController | null>(null);

  // Rotating analysis copy — "no generic loading screens"
  useEffect(() => {
    if (phase !== "analyzing") return;
    const t = setInterval(
      () => setAnalysisLine((i) => (i + 1) % ANALYZING_LINES.length),
      1400,
    );
    return () => clearInterval(t);
  }, [phase]);

  // Leave the flow → cancel any in-flight vision request.
  useEffect(() => {
    return () => visionAbortRef.current?.abort();
  }, []);

  const startAnalyze = useCallback(
    async (dataUrl: string, source: "camera" | "upload") => {
      setPreviewUrl(dataUrl);
      setPhase("analyzing");
      setError(null);
      track("meal_recommendation_viewed", { via: `scan-${source}` });

      visionAbortRef.current?.abort();
      const controller = new AbortController();
      visionAbortRef.current = controller;

      let analysis: VisionAnalysis | null = null;
      try {
        analysis = await getVisionService().detectIngredients({
          imageDataUrl: dataUrl,
          userText: textValue.trim() || undefined,
          signal: controller.signal,
        });
      } catch {
        analysis = null; // defensive: the service itself never throws
      }

      if (controller.signal.aborted) return; // user left the flow

      if (!analysis || analysis.ingredients.length === 0) {
        // Honest fallback: never fake a vision result.
        setError(analysis ? "nothing-found" : "vision-unavailable");
        setPhase("text");
        return;
      }

      setItems(
        analysis.ingredients.map((ing, i) => ({
          key: `${ing.catalogId ?? ing.label}-${i}`,
          id: ing.catalogId,
          name: ing.label,
          quantity: ing.quantity,
          uncertain: ing.uncertain,
        })),
      );
      setPhase("confirm");
      track("ingredient_added", { via: "photo", detected: analysis.ingredients.length });
    },
    [textValue],
  );

  const onFilePicked = useCallback(
    async (file: File | undefined, source: "camera" | "upload") => {
      if (!file) return;
      const prep = await prepareImageForVision(file);
      if (!prep.ok) {
        setError(prep.reason === "too-large" ? "too-big" : "bad-image");
        return;
      }
      void startAnalyze(prep.dataUrl, source);
    },
    [startAnalyze],
  );

  const removeFromList = (key: string) => setItems((xs) => xs.filter((x) => x.key !== key));
  const markCertain = (key: string) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, uncertain: false } : x)));
  // "Change" on an uncertain guess: swap it for a corrected name.
  const changeItem = (key: string, newName: string) => {
    const parsed = parseIngredientText(newName);
    const first = parsed[0];
    setItems((xs) =>
      xs.map((x) =>
        x.key === key
          ? first
            ? {
                ...x,
                id: first.ingredient.id,
                name: first.ingredient.name,
                quantity: first.estimatedQty ?? x.quantity,
                uncertain: false,
              }
            : x
          : x,
      ),
    );
    setEditingKey(null);
    setEditValue("");
  };
  const editQuantity = (key: string, q: string) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, quantity: q || undefined } : x)));

  const addNamed = (name: string) => {
    const parsed = parseIngredientText(name);
    if (parsed.length === 0) return;
    setItems((xs) => [
      ...xs,
      ...parsed
        .filter((p) => !xs.some((x) => x.id === p.ingredient.id))
        .map((p) => ({
          key: `${p.ingredient.id}-manual-${Date.now()}`,
          id: p.ingredient.id,
          name: p.ingredient.name,
          quantity: p.estimatedQty,
          uncertain: false,
        })),
    ]);
    setNewItemName("");
  };

  const confirmAndRecommend = () => {
    // Uncertain guesses never enter the kitchen unconfirmed — they either get
    // tapped "Yes", corrected, or removed. That's the anti-hallucination gate.
    const ids = items.filter((x) => !x.uncertain).map((x) => x.id).filter((x): x is string => Boolean(x));
    if (ids.length === 0) return;
    for (const id of ids) addItem(id);
    track("meal_selected", { via: "scan-confirm", ingredients: ids.length });
    go("home");
  };

  const confidentCount = items.filter((x) => !x.uncertain && x.id).length;

  const parseText = () => {
    const parsed = parseIngredientText(textValue);
    if (parsed.length === 0) return;
    setItems(
      parsed.map((p) => ({
        key: `${p.ingredient.id}-text`,
        id: p.ingredient.id,
        name: p.ingredient.name,
        quantity: p.estimatedQty,
        uncertain: false,
      })),
    );
    setPhase("confirm");
  };

  const uncertainCount = items.filter((x) => x.uncertain).length;

  return (
    <div className="pt-4 lg:pt-8">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={back}
          className="flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-2 text-[14px] font-semibold text-muted shadow-soft transition-colors hover:text-ink"
        >
          <ArrowLeft size={16} /> Back
        </button>
        {previewUrl && phase === "confirm" && (
          <span className="text-[13px] font-semibold text-sage">
            {items.length} detected{uncertainCount > 0 ? ` · ${uncertainCount} to check` : ""}
          </span>
        )}
      </div>

      <AnimatePresence mode="wait">
        {/* ── CAPTURE ─────────────────────────────────────── */}
        {phase === "capture" && (
          <motion.div
            key="capture"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <div className="relative mb-6 overflow-hidden rounded-[2rem] bg-ink p-8 text-center text-cream sm:p-10">
              {/* ambient warmth */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(480px 240px at 50% -10%, rgb(228 87 46 / 0.22), transparent 65%)",
                }}
              />
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 14 }}
                className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-cream/10"
              >
                <ScanLine size={30} strokeWidth={2} className="text-flame" />
              </motion.div>
              <h1 className="relative mt-5 font-display text-[28px] font-semibold leading-tight sm:text-[34px]">
                Show me what you&apos;ve got
              </h1>
              <p className="relative mx-auto mt-2.5 max-w-sm text-[14.5px] leading-relaxed text-cream/70">
                One photo of your counter, fridge or groceries.
                <br />
                RUCHI finds the ingredients — you confirm.
              </p>
              <div className="relative mt-7 flex flex-col gap-3">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="mx-auto flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-cream px-6 py-4 text-[15px] font-bold text-ink shadow-lifted transition-all hover:bg-white active:scale-[0.98]"
                >
                  <Camera size={18} /> Snap your ingredients
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mx-auto flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl border border-cream/25 px-6 py-3.5 text-[14px] font-semibold text-cream/90 transition-all hover:bg-cream/10 active:scale-[0.98]"
                >
                  <ImageIcon size={17} /> Upload from gallery
                </button>
              </div>
              <p className="relative mt-5 text-[11px] text-cream/50">
                Fit your ingredients inside the frame · processed instantly, never stored
              </p>
            </div>

            {/* Photo + text: "I want something high protein" */}
            <div className="mb-4">
              <div className="relative">
                <textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  rows={2}
                  placeholder='Optional: "I want something high protein and under ₹100"'
                  aria-label="Note for the scan"
                  className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 pr-11 text-[14px] shadow-soft outline-none transition-colors focus:border-ink/40"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!textValue.trim()}
                  aria-label="Attach a photo to your note"
                  className="absolute right-2.5 top-3 rounded-xl p-1.5 text-flame disabled:opacity-30"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className="mt-1.5 text-center text-[11px] text-muted">
                Add a note and RUCHI reads it with your photo.
              </p>
            </div>

            <button
              onClick={() => {
                setPhase("text");
                track("recipe_help_requested", { via: "scan-text-fallback" });
              }}
              className="mx-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-flame transition-colors hover:text-flame-deep"
            >
              <Keyboard size={14} /> Or type: &ldquo;I have eggs, tomato, paneer…&rdquo;
            </button>

            {(error === "too-big" || error === "bad-image") && (
              <div className="mt-4">
                <Note tone="flame">
                  {error === "too-big"
                    ? "That photo is too large even after compressing. Try another one."
                    : "That file isn't a photo we can read. JPEG, PNG or WebP please."}
                </Note>
              </div>
            )}
          </motion.div>
        )}

        {/* ── ANALYZING ───────────────────────────────────── */}
        {phase === "analyzing" && previewUrl && (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex flex-col items-center"
          >
            <div className="relative overflow-hidden rounded-[2rem] shadow-lifted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Your ingredients" className="max-h-72 w-auto" />
              <motion.div
                className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-flame/30 to-transparent"
                animate={{ y: [-64, 288, -64] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <div className="absolute inset-0 rounded-[2rem] border-2 border-flame/60" />
            </div>
            <motion.p
              key={analysisLine}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 text-[16px] font-semibold"
            >
              {ANALYZING_LINES[analysisLine]}
            </motion.p>
            <div className="mt-4 flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-2 w-2 rounded-full bg-flame"
                  animate={{ opacity: [0.25, 1, 0.25] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
            <button
              onClick={() => {
                visionAbortRef.current?.abort();
                setPhase("capture");
              }}
              className="mt-5 rounded-full px-4 py-2 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </motion.div>
        )}

        {/* ── CONFIRM ─────────────────────────────────────── */}
        {phase === "confirm" && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
          >
            <div className="mb-4 flex items-center gap-3.5">
              {previewUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={previewUrl}
                  alt="Your ingredients"
                  className="h-16 w-16 rounded-2xl object-cover shadow-soft"
                />
              )}
              <div>
                <h1 className="font-display text-[24px] font-semibold leading-tight sm:text-[28px]">
                  {previewUrl ? "I found these 👀" : "Got it — here's what I heard 👀"}
                </h1>
                <p className="text-[13px] text-muted">
                  {uncertainCount > 0
                    ? "A couple of guesses — check them before we cook."
                    : items.length > 0
                      ? `${items.length} ingredient${items.length === 1 ? "" : "s"} ready. Remove anything wrong, add anything missing.`
                      : "Remove anything wrong, add anything missing."}
                </p>
              </div>
            </div>

            {/* Confident items first */}
            <Card className="divide-y divide-line overflow-hidden">
              <AnimatePresence initial={false}>
                {items.filter((it) => !it.uncertain).map((it) => (
                  <motion.div
                    key={it.key}
                    layout
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={{ type: "spring", damping: 26, stiffness: 320 }}
                    className="px-4 py-3.5"
                  >
                    <ConfirmRow
                      it={it}
                      editingKey={editingKey}
                      editValue={editValue}
                      setEditingKey={setEditingKey}
                      setEditValue={setEditValue}
                      markCertain={markCertain}
                      removeFromList={removeFromList}
                      changeItem={changeItem}
                      editQuantity={editQuantity}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </Card>

            {/* Uncertain guesses — clearly separated, confirm or correct in one tap */}
            {uncertainCount > 0 && (
              <div className="mt-4">
                <p className="mb-2 px-1 text-[12px] font-bold uppercase tracking-wider text-muted">
                  Not sure about these — quick check
                </p>
                <Card className="divide-y divide-line overflow-hidden border-dashed">
                  <AnimatePresence initial={false}>
                    {items.filter((it) => it.uncertain).map((it) => (
                      <motion.div
                        key={it.key}
                        layout
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16 }}
                        transition={{ type: "spring", damping: 26, stiffness: 320 }}
                        className="px-4 py-3.5"
                      >
                        <ConfirmRow
                          it={it}
                          editingKey={editingKey}
                          editValue={editValue}
                          setEditingKey={setEditingKey}
                          setEditValue={setEditValue}
                          markCertain={markCertain}
                          removeFromList={removeFromList}
                          changeItem={changeItem}
                          editQuantity={editQuantity}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </Card>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addNamed(newItemName)}
                placeholder="+ Add a missing item…"
                aria-label="Add a missing item"
                className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] shadow-soft outline-none transition-colors focus:border-ink/40"
              />
              <Button variant="secondary" onClick={() => addNamed(newItemName)} disabled={!newItemName.trim()}>
                <Plus size={16} />
              </Button>
            </div>

            {/* Goal quick-picks (photo + goal) */}
            <div className="mt-6">
              <SectionTitle>What matters tonight?</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {GOAL_CHIPS.map((g) => (
                  <Chip
                    key={g.id}
                    selected={goals.includes(g.id)}
                    onClick={() =>
                      setGoals((cur) =>
                        cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id],
                      )
                    }
                  >
                    {g.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="sticky bottom-4 mt-8 pb-2">
              <Button
                variant="flame"
                size="lg"
                className="w-full shadow-cta"
                onClick={confirmAndRecommend}
                disabled={confidentCount === 0}
              >
                <ScanLine size={18} /> Find my meals →
              </Button>
              {confidentCount === 0 && (
                <p className="mt-2 text-center text-[12px] text-muted">
                  Confirm or fix the guesses above first — then we cook.
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* ── TEXT FALLBACK ───────────────────────────────── */}
        {phase === "text" && (
          <motion.div
            key="text"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            {error && (
              <div className="mb-5">
                <Note tone="gold">
                  {error === "vision-unavailable" &&
                    "I couldn't read the photo this time. Tell me what you have instead — same result, ten seconds."}
                  {error === "nothing-found" &&
                    "Couldn't spot any ingredients in that photo. Try a closer shot, or just type them:"}
                  {error === "network" && "That didn't go through. Type what you have instead:"}
                </Note>
              </div>
            )}

            <h1 className="font-display text-[28px] font-semibold leading-tight sm:text-[32px]">
              I have…
            </h1>
            <p className="mt-1.5 text-[14px] text-muted">
              Just list them naturally — like you&apos;d tell a flatmate.
            </p>
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              rows={3}
              autoFocus
              placeholder="I have 4 eggs, some paneer, 2 tomatoes, onion and rice"
              aria-label="Type your ingredients"
              className="mt-4 w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3.5 text-[15px] shadow-soft outline-none transition-colors focus:border-ink/40"
            />
            <Button variant="flame" size="lg" className="mt-3 w-full shadow-cta" onClick={parseText} disabled={!textValue.trim()}>
              <Sparkles size={16} /> Find my meals →
            </Button>

            <div className="mt-8 flex flex-wrap gap-2">
              {["eggs, tomato, onion, paneer, rice", "chicken, curd, rice", "bread, eggs, butter"].map(
                (ex) => (
                  <button
                    key={ex}
                    onClick={() => setTextValue(`I have ${ex}`)}
                    className="rounded-full border border-line bg-surface px-3.5 py-2 text-[12px] font-medium text-muted transition-colors hover:text-ink"
                  >
                    &ldquo;{ex}&rdquo;
                  </button>
                ),
              )}
            </div>

            <button
              onClick={() => {
                setPhase("capture");
                setError(null);
              }}
              className="mx-auto mt-8 flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-flame transition-colors hover:text-flame-deep"
            >
              <RotateCcw size={13} /> Try the photo again
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* hidden inputs for camera + gallery */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0], "camera");
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0], "upload");
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── Confirm row (shared by certain + uncertain lists) ───────

function ConfirmRow({
  it,
  editingKey,
  editValue,
  setEditingKey,
  setEditValue,
  markCertain,
  removeFromList,
  changeItem,
  editQuantity,
}: {
  it: ConfirmItem;
  editingKey: string | null;
  editValue: string;
  setEditingKey: (k: string | null) => void;
  setEditValue: (v: string) => void;
  markCertain: (key: string) => void;
  removeFromList: (key: string) => void;
  changeItem: (key: string, v: string) => void;
  editQuantity: (key: string, v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-xl" aria-hidden>{emojiFor(it.id ?? it.name)}</span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">
              {it.name.charAt(0).toUpperCase() + it.name.slice(1)}
              {it.quantity ? (
                <button
                  onClick={() => {
                    setEditingKey(it.key);
                    setEditValue(it.quantity ?? "");
                  }}
                  className="ml-2 rounded-full bg-flame-soft px-2 py-0.5 text-[12px] font-bold text-flame-deep"
                  aria-label={`Edit quantity of ${it.name}`}
                >
                  × {it.quantity} ✎
                </button>
              ) : (
                <button
                  onClick={() => {
                    setEditingKey(it.key);
                    setEditValue("");
                  }}
                  className="ml-2 text-[12px] font-medium text-muted underline underline-offset-2"
                >
                  set quantity
                </button>
              )}
            </p>
            {it.uncertain && (
              <p className="text-[12px] text-muted">I think this is {it.name}. Is that right?</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {it.uncertain && (
            <>
              <button
                onClick={() => markCertain(it.key)}
                className="rounded-full bg-sage-soft px-2.5 py-1.5 text-[12px] font-bold text-sage transition-colors hover:bg-sage/20"
              >
                <Check size={12} className="mr-0.5 inline" /> Yes
              </button>
              <button
                onClick={() => {
                  setEditingKey(it.key);
                  setEditValue("");
                }}
                className="rounded-full border border-line bg-surface px-2.5 py-1.5 text-[12px] font-bold text-ink"
              >
                Change
              </button>
            </>
          )}
          <button
            onClick={() => removeFromList(it.key)}
            className="rounded-full p-1.5 text-muted transition-colors hover:text-ink"
            aria-label={`Remove ${it.name}`}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {/* inline editor for quantity / correction */}
      {editingKey === it.key && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="mt-2 flex gap-2 overflow-hidden"
        >
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (it.uncertain) changeItem(it.key, editValue);
                else editQuantity(it.key, editValue);
              }
              if (e.key === "Escape") setEditingKey(null);
            }}
            placeholder={it.uncertain ? "What is it actually?" : "e.g. 4, ~200 g"}
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-ink/40"
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (it.uncertain) changeItem(it.key, editValue);
              else editQuantity(it.key, editValue);
            }}
          >
            <Check size={15} />
          </Button>
        </motion.div>
      )}
    </div>
  );
}
