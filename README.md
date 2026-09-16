# RUCHI — రుచి

**Don't ask what to cook. Show RUCHI what you have.**
Healthy. Affordable. Simple. Let's cook.

RUCHI is not a recipe database. It turns "I'm hungry but I don't know what to make" into a cooked, high-protein meal — with exact quantities, guided step-by-step cooking, nutrition, and what you saved vs. ordering in.

## Quick start

```bash
npm install
npm run dev
# http://localhost:3000
```

```bash
npm run build      # production build
npm run typecheck  # strict TypeScript check
```

## The product loop

INGREDIENTS → DECISION → MEAL → EXACT QUANTITIES → GUIDED COOKING → NUTRITION → SAVINGS → RE-ENGAGEMENT

1. **Home** — add what's in your kitchen (search + quick chips), pick a mood (💪 High Protein, ⚡ Quick…), set time/budget/people — no form feel.
2. **Decision** — exactly 3–4 matched dishes with protein, kcal, cost, time, difficulty and cheeky one-liners.
3. **Meal** — exact quantities for your serving count (2 eggs, 100g paneer, ½ medium onion — never "salt to taste"), dynamic nutrition + cost, substitutions.
4. **Cooking Mode** — full-screen, one step at a time, timer, heat level, LOOK FOR visual cue, contextual help ("How do I know it's ready?").
5. **Done** — "That wasn't a recipe. That was dinner." + what you saved vs delivery, logged to your streak.

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript strict**
- **Tailwind CSS v4**
- **Zustand** — client state, persisted to localStorage
- **Zod** — validates every AI payload and the recipe dataset
- **Framer Motion** — small, purposeful motion
- **Lucide** icons

No backend database: a single-user local MVP. The data layer is designed so an auth + Postgres/Prisma layer can replace the client store without touching UI.

## Architecture

```
src/
  app/            App Router entry, single-page experience
  components/     UI kit (chips, buttons, sheets, cards, nav)
  lib/
    ai/           provider abstraction + schema-validated engine
    data/         ingredient catalog + curated recipe dataset (Zod-validated)
    engine/       matching, nutrition, cost, formatting, nudge engine
    store/        client state
    types/        shared domain types
```

- **AI is a service, not the product.** All AI runs through [Puter.js](https://docs.puter.com/AI/) behind provider-agnostic interfaces in `lib/ai` (`IngredientVisionService`, `MealRecommendationService`, `CookingAssistantService`). No API keys exist in the codebase — Puter handles auth in the browser (user-pays). Every capability has a deterministic fallback, so the app is fully functional offline or when Puter is unavailable.
- **Nutrition and cost are always labeled estimates.** Values come from per-100g reference tables, never presented as medical or financial facts.
- **Cooking Mode owns the screen.** No nav, no clutter — one instruction, one cue, one timer.

## AI layer

```
src/lib/ai/
  index.ts            public surface — the ONLY module the app imports
  types.ts            provider-agnostic service interfaces
  config.ts           AI_PROVIDER / VISION_MODEL / TEXT_MODEL (env-tunable)
  puter.ts            the only file that imports @heyputer/puter.js
  prompts.ts          engineered prompts (vision catalog fence, JSON contracts)
  schemas.ts          Zod contracts — every AI payload is untrusted until parsed
  vision.ts           IngredientVisionService: photo → validated ingredients
  recommendations.ts  MealRecommendationService: re-ranks curated candidates
  assistant.ts        CookingAssistantService: step-aware cooking help
  image.ts            client-side validate/resize/compress before any request
  observability.ts    dev-only lifecycle logs (never images, text, or keys)
```

**Vision model: `gpt-5-nano` (default).** Chosen for image understanding (`modalities.input` includes `image` in Puter's catalog), low latency on the critical photo path, strong JSON adherence for the strict ingredient schema, and the lowest input cost in Puter's OpenAI tier — the user pays per token, so cheap and fast is the premium experience. Change with `VISION_MODEL` / `TEXT_MODEL`; alternates are validated against Puter's model catalog (`modalities.input`) before use.

**Hard rules:** AI output is untrusted — Zod-validated or rejected; the AI may only pick recipe ids from the deterministic candidate list (never invent recipes); nutrition/cost/servings are always computed by the app from reference tables, never generated; vision failure degrades to the text path ("Tell me what you have") and never fakes results.

## Accounts & cloud sync (Puter)

Accounts are lightweight and anonymous-first — they never gate the core loop:

```
src/lib/auth/
  puter-auth.ts       identity + cloud snapshot over the Puter SDK (no new providers)
```

- The app works fully without an account. When the user wants persistence across devices, one tap (**Connect Puter**) opens Puter's browser sign-in — the same account the AI layer may already use. No app-held credentials, no extra auth provider.
- Durable state (name, inventory, preferences, cooked-meal history) mirrors to the user's Puter KV ~1.2s after any change, debounced and deduplicated. The cloud is a **mirror, not the source of truth**: on sign-in, cloud data fills in only what's missing locally and never deletes or overwrites local progress (history merges by id).
- Transient state (nudges, read flags) stays local. Sign-out clears the session but keeps local cooking data.

## The streak

Streaks count **consecutive local-calendar days** with at least one cooked meal (`computeStreak` in `src/lib/store/index.ts`): multiple meals a day count once; a day with no meal resets the count; a streak without today's meal still shows while today is open (cook tonight to keep it). It is celebrated once — at meal completion — and summarized in Home/Profile.

## Safety

Raw-meat and egg steps carry explicit safety guidance (no tasting raw egg mixtures, 74°C chicken doneness, cross-contamination). Nutrition is an estimate, not medical advice.
