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
  Sparkles,
  X,
} from "lucide-react";
import { Button, Card, Chip, Note, Pill, SectionTitle } from "@/components/ui";
import { useScreen } from "@/lib/store/screens";
import { useRuchi } from "@/lib/store";
import { INGREDIENTS, findIngredient } from "@/lib/data/ingredients";
import { parseIngredientText } from "@/lib/engine/parse";
import { track } from "@/lib/engine/analytics";
import type { DetectedItem } from "@/lib/ai";
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
  "Counting the eggs...",
  "Checking what's ripe...",
  "Almost there...",
];

function emojiFor(idOrName: string): string {
  const ing = findIngredient(idOrName) ?? INGREDIENTS.find((i) => i.name === idOrName);
  const map: Record<string, string> = {
    egg: "🥚", paneer: "🧀", tomato: "🍅", onion: "🧅", potato: "🥔",
    rice: "🍚", bread: "🍞", curd: "🥛", milk: "🥛", carrot: "🥕",
    "green-chili": "🌶️", capsicum: "🫑", lemon: "🍋", chicken: "🍗",
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

  // Rotating analysis copy — "no generic loading screens"
  useEffect(() => {
    if (phase !== "analyzing") return;
    const t = setInterval(
      () => setAnalysisLine((i) => (i + 1) % ANALYZING_LINES.length),
      1400,
    );
    return () => clearInterval(t);
  }, [phase]);

  const startAnalyze = useCallback(async (dataUrl: string, source: "camera" | "upload") => {
    setPreviewUrl(dataUrl);
    setPhase("analyzing");
    setError(null);
    track("meal_recommendation_viewed", { via: `scan-${source}` });
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        reason?: string;
        items?: DetectedItem[];
        lowConfidence?: boolean;
      };
      if (!json.ok || !json.items) {
        // Vision unavailable → honest text fallback
        setError("vision-unavailable");
        setPhase("text");
        return;
      }
      if (json.items.length === 0) {
        setError("nothing-found");
        setPhase("text");
        return;
      }
      setItems(
        json.items.map((it, i) => ({
          key: `${it.id ?? it.name}-${i}`,
          id: it.id,
          name: it.name,
          quantity: it.estimatedQuantity,
          uncertain: it.uncertain,
        })),
      );
      setPhase("confirm");
      track("ingredient_added", { via: "photo", detected: json.items.length });
    } catch {
      setError("network");
      setPhase("text");
    }
  }, []);

  const onFilePicked = useCallback(
    (file: File | undefined, source: "camera" | "upload") => {
      if (!file) return;
      if (file.size > 4.2 * 1024 * 1024) {
        setError("too-big");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") void startAnalyze(reader.result, source);
      };
      reader.onerror = () => setError("read-failed");
      reader.readAsDataURL(file);
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
    const ids = items.map((x) => x.id).filter((x): x is string => Boolean(x));
    if (ids.length === 0) return;
    for (const id of ids) addItem(id);
    track("meal_selected", { via: "scan-confirm", ingredients: ids.length });
    go("home");
  };

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

  // The "why" for recommendations after confirmation happens on Home.
  const uncertainCount = items.filter((x) => x.uncertain).length;

  return (
    <div className="pt-4">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={back}
          className="flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft size={17} /> Back
        </button>
        {previewUrl && phase === "confirm" && (
          <Pill tone="protein">
            {items.length} detected{uncertainCount > 0 ? ` · ${uncertainCount} to check` : ""}
          </Pill>
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
            <div className="relative mb-6 overflow-hidden rounded-3xl bg-ink p-8 text-center text-cream">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 14 }}
                className="text-5xl"
              >
                📸
              </motion.div>
              <h1 className="mt-4 font-display text-[26px] font-bold leading-tight">
                Show me what you&apos;ve got
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-cream/70">
                One photo of your counter, fridge or groceries.
                <br />
                RUCHI finds the ingredients — you confirm.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="mx-auto flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-cream px-6 py-4 text-[15px] font-bold text-ink active:scale-[0.98]"
                >
                  <Camera size={18} /> Snap your ingredients
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mx-auto flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl border border-cream/25 px-6 py-3.5 text-[14px] font-semibold text-cream/90 active:scale-[0.98]"
                >
                  <ImageIcon size={17} /> Upload from gallery
                </button>
              </div>
              <p className="mt-4 text-[11px] text-cream/50">
                Fit your ingredients inside the frame · processed instantly, never stored
              </p>
            </div>

            <button
              onClick={() => {
                setPhase("text");
                track("recipe_help_requested", { via: "scan-text-fallback" });
              }}
              className="mx-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-flame"
            >
              <Keyboard size={14} /> Or type: &ldquo;I have eggs, tomato, paneer…&rdquo;
            </button>

            {error === "too-big" && (
              <div className="mt-4">
                <Note tone="flame">
                  That photo is over 4MB. Try another one — most camera photos are fine.
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
            <div className="relative overflow-hidden rounded-3xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Your ingredients" className="max-h-72 w-auto" />
              <motion.div
                className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-flame/25 to-transparent"
                animate={{ y: [-64, 288, -64] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <div className="absolute inset-0 border-4 border-flame/60 rounded-3xl" />
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
            <div className="mb-4 flex items-center gap-3">
              {previewUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={previewUrl}
                  alt="Your ingredients"
                  className="h-16 w-16 rounded-2xl object-cover"
                />
              )}
              <div>
                <h1 className="font-display text-[24px] font-bold leading-tight">
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

            <Card className="divide-y divide-line overflow-hidden">
              <AnimatePresence initial={false}>
                {items.map((it) => (
                  <motion.div
                    key={it.key}
                    layout
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={{ type: "spring", damping: 26, stiffness: 320 }}
                    className="px-4 py-3"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="text-xl">{emojiFor(it.id ?? it.name)}</span>
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
                                  className="ml-2 text-[12px] font-medium text-muted underline"
                                >
                                  set quantity
                                </button>
                              )}
                            </p>
                            {it.uncertain && (
                              <p className="text-[12px] text-muted">
                                I think this is {it.name}. Is that right?
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {it.uncertain && (
                            <>
                              <button
                                onClick={() => markCertain(it.key)}
                                className="rounded-full bg-sage-soft px-2.5 py-1.5 text-[12px] font-bold text-sage"
                              >
                                <Check size={12} className="mr-0.5 inline" /> Yes
                              </button>
                              <button
                                onClick={() => {
                                  setEditingKey(it.key);
                                  setEditValue("");
                                }}
                                className="rounded-full border border-line bg-white px-2.5 py-1.5 text-[12px] font-bold text-ink"
                              >
                                Change
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => removeFromList(it.key)}
                            className="rounded-full p-1.5 text-muted hover:text-ink"
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
                            className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-[14px] outline-none focus:border-ink/40"
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
                  </motion.div>
                ))}
              </AnimatePresence>
            </Card>

            {/* Add missing item */}
            <div className="mt-4 flex gap-2">
              <input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addNamed(newItemName)}
                placeholder="+ Add a missing item…"
                className="min-w-0 flex-1 rounded-2xl border border-line bg-white px-4 py-3 text-[14px] outline-none focus:border-ink/40"
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
              <Button className="w-full py-4 text-base shadow-lg shadow-ink/15" onClick={confirmAndRecommend}>
                <ScanLine size={18} /> Find my meals →
              </Button>
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
                    "Photo reading isn't set up on this device yet. Type what you have instead — same result, ten seconds."}
                  {error === "nothing-found" &&
                    "Couldn't spot any ingredients in that photo. Try a closer shot, or just type them:"}
                  {error === "network" && "That didn't go through. Type what you have instead:"}
                </Note>
              </div>
            )}

            <h1 className="font-display text-[26px] font-bold leading-tight">
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
              className="mt-4 w-full resize-none rounded-2xl border border-line bg-white px-4 py-3.5 text-[15px] outline-none focus:border-ink/40"
            />
            <Button className="mt-3 w-full" onClick={parseText} disabled={!textValue.trim()}>
              <Sparkles size={16} /> Find my meals →
            </Button>

            <div className="mt-8 flex flex-wrap gap-2">
              {["eggs, tomato, onion, paneer, rice", "chicken, curd, rice", "bread, eggs, butter"].map(
                (ex) => (
                  <button
                    key={ex}
                    onClick={() => setTextValue(`I have ${ex}`)}
                    className="rounded-full border border-line bg-white px-3.5 py-2 text-[12px] font-medium text-muted hover:text-ink"
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
              className="mx-auto mt-8 flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-flame"
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
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onFilePicked(e.target.files?.[0], "camera");
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFilePicked(e.target.files?.[0], "upload");
          e.target.value = "";
        }}
      />
    </div>
  );
}
