# RUCHI Design & System Audit — Sept 2026

*(Internal working notes for the premium redesign pass — not product copy.)*

## What exists (working, preserved)

**Architecture (untouched):**
- Client-only Next.js 15 App Router, single-page experience; screen router in `lib/store/screens.ts`
- Zustand store `useRuchi` + derived `deriveAuthFlowState` state machine
- Deterministic engine (`lib/engine`) — source of truth; Gemini (server route) = image analysis only
- Supabase auth + durable data; boot splash → authFlow routing in `SafeArea`

**Screens:** Home, Discover, Kitchen, Profile, Meal, Scan, Cooking (full-screen overlay), Welcome gate (pre-auth)
**Components:** ui.tsx primitives (Button, Card, Chip, Pill, SectionTitle, SectionDisplay, Stat, Note, EmptyState, Skeleton), FoodVisual (gradient+emoji "images"), RecipeCard, RuchiLogo, TopNav/BottomNav, motion.tsx (PageTransition, StaggerGroup/Item), AuthCard, WelcomeGate

**Tokens (globals.css):** cream/surface/ink foundation; flame terracotta, sage, gold; Fraunces display + Inter; soft shadows; grain; reduced-motion global kill switch

## Gaps vs premium bar

1. **Typography** — display caps at ~44px mobile / ~56px desktop; no fluid scale; metadata hierarchy flat.
2. **Home** — hero composition boxy; weekly-progress and empty-kitchen cards plain; desktop under-uses width.
3. **Recipe cards** — flat; no image-reveal or aspect system; hover minimal.
4. **Discover** — chrome generic; no editorial rhythm; same grid as Home.
5. **Meal detail** — nutrition is a number grid; scaler plain; delivery math buried.
6. **Cooking Mode** — step type too small; timer functional but not beautiful; plain completion.
7. **Scan** — confirm rows plain; no staggered reveal; uncertain section weak visually.
8. **Kitchen** — plain list; no grouping.
9. **Profile** — utilitarian stacking.
10. **Nav** — scan raised square reads heavy; no integrated emphasis.
11. **States** — primitives exist but inconsistently applied.
12. **Responsive** — 768–1024 awkward (md column stretches); no intentional md treatment.
13. **Motion** — good base; missing image reveal, hover polish, number transitions.

## Design system plan (this pass)

- **Tokens:** fluid `clamp()` display scale; layered shadows (`card`, `modal`); glass utility; hairline borders. Keep flame/sage/gold discipline.
- **Primitives:** `Eyebrow`, `SectionHeading`, `MetaLine`, `NumberFlow` (number transitions), `Ring` timer progress — APIs of existing primitives stay stable.
- **RecipeCard:** editorial 4/3 visual, hover zoom + title shift, typographic metadata, prominent cost.
- **Home:** fluid serif hero w/ italic accent; upgraded layered hero visual (chips → plate → floating meal card w/ real engine numbers); quiet weekly band; editorial "Cook something good" rows; quick/high-protein/budget rails; final CTA. Data strictly from RECIPES + engine.
- **Discover:** editorial header, command-style search, polished filter sheet, animated collection pill.
- **Meal:** editorial hero, stat band w/ NumberFlow, segmented servings control, refined lists, highlighted delivery math, sticky mobile CTA.
- **Cooking Mode:** bigger step display, ring-progress timer, quieter chrome, polished completion view.
- **Scan:** layered capture panel w/ scanline; staggered confirm rows; distinct uncertain section.
- **Kitchen:** category grouping; "right now" section stays top.
- **Profile:** rhythm + stat band + refined lists.
- **Auth:** premium gate composition + refined card; flows/authReady/error copy unchanged.
- **Nav:** glass TopNav + animated pill; BottomNav scan as integrated emphasized tab.
- **Responsive:** intentional `md:` treatment; ≥44px touch targets.
- **A11y/Perf:** flame focus ring global; transform/opacity-only motion; reduced-motion everywhere; no new deps.

## Contracts to preserve (enforced by tests)

- `branding.test.ts`: exact `RuchiLogo` usages (44 / 72+priority / 28+priority), layout icon + manifest wiring
- `auth-flow.test.ts`: SafeArea `splashUp` derivation, `SPLASH_CAP_MS`, `<WelcomeGate`, authFlow state strings
- `auth-ready.test.ts`: AuthCard `authReady` gating, skeleton branch (aria-hidden, no `<input`), no persisted auth state
- No engine/auth/data/AI-boundary changes; visual-only files
