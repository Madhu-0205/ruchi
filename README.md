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

- **AI is a service, not the product.** `lib/ai` abstracts providers behind a schema-validated interface; without a key it falls back to the deterministic matching engine, so the app is fully functional offline.
- **Nutrition and cost are always labeled estimates.** Values come from per-100g reference tables, never presented as medical or financial facts.
- **Cooking Mode owns the screen.** No nav, no clutter — one instruction, one cue, one timer.

## Safety

Raw-meat and egg steps carry explicit safety guidance (no tasting raw egg mixtures, 74°C chicken doneness, cross-contamination). Nutrition is an estimate, not medical advice.
