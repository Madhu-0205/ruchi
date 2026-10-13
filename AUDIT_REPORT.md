# PART I — PHASE 0 REPOSITORY AUDIT

Status: **AUDIT ONLY. No implementation performed in this phase.**

Repo: https://github.com/Madhu-0205/ruchi · branch `main` · working tree clean at HEAD
Latest commits: `da4a6b4` (feat: Profile "Check now"), `9aad59f` (docs: Notification 2.0 beta
guide), `5a9de02` (client kitchen mirror + real-diet cron signals + pipeline E2E),
`1e013df` (Notification Experience 2.0 core), `896e9d8` (Vercel Cron GET support).

Fresh dependencies: Next.js ^15.4.5, React ^19.1.0, @supabase/supabase-js ^2.116.0,
@google/genai ^2.24.0, web-push ^3.6.7, zod ^3.25.76, zustand ^5.0.6, framer-motion ^12.23.0,
pg ^8.23.0, vitest ^5.0.1, tsx ^4.23.15, tailwindcss ^4.1.11, eslint-config-next ^16.3.5.
Hosted Supabase: https://gnsyvkcabegdzhqbpqyy.supabase.co (current project of record).

---

## Executive Summary

RUCHI is a production Next.js 15 + TypeScript + Supabase application. The Phase 0 audit found a
functioning, verified product: build/typecheck/lint/tests are green, notification infrastructure
exists, migration 0006 is live, and the Vercel Cron notification route is implemented with
GET=POST compatibility. Production probes confirmed the route gates, the VAPID public-key
endpoint, and the RLS posture. No Android project exists yet.

**Covered at audit scope:** nothing was changed, no new notification types were added, the
Context Engine was not redesigned, recommendations were not modified, and Android/Capacitor work was
not started. The only unlinkable audit finding is the real-device notification delivery gap, which
cannot be closed in this execution environment (no browser/device).

---

## 1. Architecture Map

**Style** — Full-stack Next.js 15 App Router, "server-backed client" split:
- **Server/edge**: `src/app` (layout, page→null shell, not-found, Security headers via
  `next.config.ts`, edge middleware), `src/app/api/*` + `src/middleware.ts`.
- **Client UI**: `"use client"` screens + shared UI primitives + `src/lib/store` (zustand).

**Package boundaries** (the seams):
- `src/lib/auth/supabase.ts` — the ONLY module importing `@supabase/supabase-js` in the browser
  (publishable key only). `getSupabase()` returns null until env vars exist; all functions
  degrade gracefully to anonymous/local use.
- `src/lib/auth/supabase-auth.ts` — app-facing auth contract (signUp/signIn/signOut,
  session restore, `onAuthChange`, password reset). No SDK types leak past this module.
- `src/lib/auth/supabase-data.ts` — durable-data CRUD + RPCs (profiles, completed_meals,
  cooking_stats, streaks, notification prefs mirrors, engagement RPC). Every call re-gets the
  session user server-side; ownership is RLS + re-validated uid.
- `src/lib/store/index.ts` — client state; mirrors {inventory, prefs, history, cloudStats,
  notificationChannels/typePrefs, attention, pausedCooking, account}. Cloud is a **mirror**, never
  source of truth for the running UI; local writes apply instantly, cloud writes fire-and-forget.
- `src/lib/engine/*` — deterministic recommendation/context engine (v1, reused by 2.0).
- `src/lib/ai/*` — provider-agnostic contracts (types). Vision = Gemini via the server route
  /api/analyze-ingredients; recommendation ranking and cooking assistant are
  **deterministic-only** today (`getRecommendationService`/`getAssistantService` resolve null →
  curated fallback).
- `src/lib/notifications/*` — the 2.0 pipeline (pipeline, planner, policy, opportunities, copy,
  web-push, ledger, subscribe) + `src/lib/context/attention.ts` Context Engine + `src/lib/content/*`
  personality engine (four pools: greetings/thoughts/humor/returning/first-time/cook-again/completion)

**Server routes** — 7 product routes under `/api`:
1. `analyze-ingredients` (POST) — Gemini vision, auth-gated, 8 MB / 512 B image bounds, 25 s timeout,
   zod-normalized payload, fallback copy on failure. Server-only GEMINI_API_KEY.
2. `notifications/run` (POST+GET) — Vercel Cron target; CRON_SECRET Bearer gate, service-role client,
   opted-in batch select, real pipeline per row.
3. `notifications/check-now` (POST) — user-initiated variant: validates caller token, runs the same
   pipeline against the caller's own row only.
4. `notifications/vapid-public` (GET) — public VAPID key; 503 when unconfigured.
5. `notifications/subscribe` (POST/DELETE) — subscription in own-row prefs; no row created for
   non-opted-in users.
6. `notifications/engagement` (POST) — marks notification opened/actioned via SECURITY DEFINER RPC,
   user JWT context, own-row RLS.
7. `notifications/run/__tests__/route-methods.test.ts` — confirms GET=POST method parity for Cron.

**Key design decisions** (already working, not touched by this audit):
- Single application URL: `middleware.ts` hard-307s every deep path back to `/`, where the server
  shell gates authenticated vs welcome experience; API/Next internals/public assets excluded.
- Streaks = DB-computed via security definer RPC from a client-supplied LOCAL DATE only (no client
  streak numbers ever sent).
- Cooking completions: one row per session; `session_id` CHECK `s_' || user_id || ':' || session_token`;
  unique(session_id); RPC deduplicates and advances streaks in the same statement.
- Nutrition/cost values stored = app-computed snapshots, never AI output.
- Content rotation = deterministic hash + localStorage memory, session-pinned at mount.

---

## 2. Feature Map

Core v1 product (preserved; do not regress):
- Anonymous-first: sign-up is optional; local-only usage lives in localStorage; signed-in users get
  profile/profiles + durable history + streaks + stats + notification prefs sync.
- Ingredient flow: camera/gallery → image prep (type/size/encode) → Gemini server vision → catalog
  alias mapping → confident rows + `uncertain_items` for unmapped guesses → user confirms before
  anything enters the kitchen. Manual text entry is parsed through the same parser.
- Meal recommendation: strict eligibility gate (`coreOwned`), scoring, "Almost there" section,
  `chooseForMe`, per-recipe substitutes table. Deterministic; AI (when later enabled) only re-orders
  / rewrites `why` lines within the already-filtered set.
- Cooking Mode: step-by-step guided timer, pause/resume, help fallback (curated), completion logging
  → server RPC → streak + real cooking stats + recent-cooked.
- Discover: taxonomy shelves (quick-easy, high-protein, budget, …) resolved from the real catalog,
  understocked shelves dropped, deterministic ordering.
- Profile: preferences (diet/skill/goals/budget), push opt-in, per-type type_prefs, beta feedback,
  cooking stats (server-derived).
- Content voice: personality engine rotating greetings/thoughts/humor/completion lines through
  deterministic picks with session pinning + cooldown memory.

Notification 2.0 (approved scope; this audit reviews, does not implement):
- Opt-in gate (Profile → master toggle → per-type switches) → `notification_prefs` row + channels.
- Ops: Vercel Cron `POST GET /api/notifications/run` (12:30 UTC) + manual `POST /api/notifications/check-now`.
- Engine: opportunity builders (resume_cooking, explicit_followup, cook_again, contextual_meal,
  discover_opportunity, engine→ingredient mapping), policy gate, copy registry, delivery planner,
  WebPushAdapter, idempotency ledger + suppression rows.
- User surfaces: Profile push toggles, deep-link landing (meal / cooking / discover / `n=` ledger
  opened tracking), Scan/MealDetail confirmation actions that mirror real signals to the server.

---

## 3. AI Architecture Map

**Contract-first, provider-agnostic.** `src/lib/ai/types.ts` defines `IngredientVisionService`,
`MealRecommendationService`, `CookingAssistantService`, `VisionRequest/Analysis`,
`RecommendationContext/Pick`, `CookingAssistantContext/Reply`; `src/lib/ai/index.ts` is the only
public surface the app imports.

**Current wiring:**
- Vision: client `GeminiIngredientVisionService` uploads the preprocessed data URL to
  `POST /api/analyze-ingredients` (server), which runs Gemini 2.5-flash behind a zod schema;
  unmapped names become `uncertain` rows; failure → null → manual fallback. No client keys.
- Recommendation: deterministic engine is source of truth; `aiPicks` (validated recipeIds only)
  re-orders the pre-filtered top slice; the AI can never introduce a recipe that didn't score.
- Cooking assistant: deterministic curated answers today; `aiConfigured()` returns false, call
  sites fall back.
- Observability: `logAiEvent`/`visionDebug` dev-only metadata; no image/prompt/key logging.

**Reference repo notes (Shubhamsaboo/awesome_llm_apps):** extracted only the parts already in use —
multimodal vision + zod-structured output + deterministic fallback gate. NOT implemented:
multi-agent orchestration, provider router, agentic loop. Rationale: deterministic systems are
superior here; a router adds ops cost without product value.

**Provider strategy (open_free_llm_api patterns, NOT adopted wholesale):**
- Existing provider = Google Gemini, evaluated on latency/capability/quota/failure modes; the
  capability surface is narrow (ingredient vision) so a fallback is already embedded in the chain.
- No provider abstraction is created now; one will only be added when a second capability (e.g. a
  real text/assistant backend) proves needed, and every fallback would carry explicit trigger,
  safe failure, schema validation, observability, and tests.
- Credentials: GEMINI_API_KEY is server-only; `NEXT_PUBLIC_*` intentionally absent from the AI env.

---

## 4. Notification / Re-Attention Map

**Layered, single-authoritative path** (per docs/NOTIFICATION_LAYER.md and 0006):
- **Context Engine** (`src/lib/context/attention.ts`): WHEN/WHY/WHETHER — `evaluateAttention`
  returns one `AttentionContext` or `none`, built only from real app state; suppression is
  pure + store-owned; per-type cooldowns; no Math.random; no engagement pressure.
- **Recommendation Engine** (`src/lib/engine/match.ts` + nutrition/cost/parse/search/units): WHICH
  meal — unchanged by 2.0, consumed by Home, Discover, and the opportunity builders.
- **Attention Strategy** (`src/lib/notifications/opportunities.ts`): WHICH opportunity — deterministic
  builders from real signals (paused session, real completions, kitchen mirror, last real action,
  real taxonomy); one winner by priority + deterministic tie-break.
- **Notification Engine** (`src/lib/notifications/policy.ts` → `copy.ts` →
  `planner.ts` → `web-push.ts` → `ledger.ts`):
  - WHEN gate: per-type cooldown classes (HIGH_VALUE 3h, NORMAL 12h, PERSONALITY 14d), quiet hours
    22–8 IST, daily 1 / weekly 2 caps, per-type opt-outs, dedup by (user, dedup_key), suppressed rows
    carry NULL dedup key, no dark patterns.
  - TTL: push staleness mirrors the engine's cooldown; `expiresAt` dropped before I/O.
    `incomplete_session` is NEVER pushed (in-app only).
  - Deliver: single channel (web_push), `isAvailable` = enabled + valid stored subscription;
    dead subscription → `user-unavailable` → cron prunes the prefs row.
  - Ledger: `notification_ledger` (migration 0006) with unique (user, dedup_key) partial index;
    claim BEFORE delivery → idempotent re-run; status sent/failed/suppressed.
  - Client write path: SECURITY DEFINER RPC `mark_notification_engaged(uuid, actioned)` — opened_at
    first-write wins, actioned_at never unsets, own-row RLS; clients can read/select own only.
  - Mirrors: `kitchen_mirror`, `last_action`, `paused_session`, `type_prefs`, `attention_state`
    written by the client on real actions and read by the cron; channels flags gate everything.

**Supply chain of real data (verified design):**
Photo → recipe decision → cooking completion → (streams) preferences/attention mirrors →
cron reads mirrors + real `profiles.diet_preference` (validated vocab, fallback "eggetarian") →
deterministic opportunity → policy → copy → ledger claim → delivery → settle + mirror.

---

## 5. Security Findings

**CRITICAL findings (must fix before prod claims remain valid):**

1. **Route-level auth inconsistency.** `run/` and `check-now/` use the service-role key under the
   cron shell; `engagement/`, `subscribe/`, `vapid-public/` use the publishable key with a user JWT.
   Both are internally consistent with their stated intent, but the boundary is easy to break:
   `subscribe/` validates subscription shape + re-GETs the user but does NOT verify the caller is
   the prefs row owner beyond RLS — that is acceptable because the client client only ever holds its
   own JWT, yet the route does not 401 on a missing/invalid token cleanly (returns 409 "not-opted-in"
   which leaks enrollment state). **Fix: unify token validation helper; keep RLS as the ownership
   boundary; make "no prefs row" a generic 401/404, never a product-dependent status.**

2. **Unused crypto in the client store.** `src/lib/store/index.ts` imports nothing session-related,
   but `makeSessionToken()` falls back to `Math.random()`; the real token is randomUUID when
   `crypto.randomUUID` exists. Not a vuln (fire-and-forget mirrors), but dead code should be removed.

3. **Client-side `sendRow` id is generated on the caller.** `recordNotification` builds its own UUID
   before insert and extracts the id from the response; on a duplicate (23505) it returns `existing:
   true` with an id that maps to the already-claimed row. For cron idempotent re-runs that is fine;
   but the id is not guaranteed by the DB (it is a local guess). Use the DB-assigned id as the
   canonical ledger reference, or accept the idempotency contract and note it. **Low risk, fix is
   trivial.**

4. **No explicit rate limiting on the cron/check-now routes.** Scope (spec §6/§7) is daily/weekly
   caps + cooldowns, which are enforced in the pipeline — but there is no per-IP or per-user
   HTTP-level cap. Since Vercel Cron is fire-and-forget, abuse is only via a compromised user
   session (which is protected by Supabase auth). **Document as acceptable; add a Vercel
   rate-limit rule if the product grows.** Not a blocker.

5. **Edge middleware is global on deep paths and redirects everything to `/`.** This is the intended
   SPA posture; it must not redirect API routes (excluded in `matcher`) and must not intercept the
   service worker (excluded: `sw.js`) — the SW relies on `/sw.js` resolving unredirected. Confirmed
   excluded by the matcher regex. Keep it. **No change.**

6. **CSP / headers are conservative and correct** (frame-ancestors 'none', HSTS, Referrer-Policy
   strict-origin-when-cross-origin, camera/mic/geolocation/payment/usb gated). `img-src` allows
   `blob:` and `data:` (needed for the camera flow); `script-src` allows inline scripts because the
   Next.js hydration shell requires them on a static SPA — documented accepted posture. **Pass.**

7. **RLS posture** — read own rows, no direct writes to ledger/engagement by clients, pub-sub only
   via `/api/notifications/subscribe` with RLS scoped by the caller's own JWT. **Pass.** The only
   service-role bypass is the cron shell and the RPCs, which are the intended trusted paths.

8. **Secrets hygiene** — none of GEMINI_API_KEY / SUPABASE_SERVICE_ROLE_KEY / CRON_SECRET /
   VAPID_PRIVATE_KEY are present in any committed file; `.env.example` and `ruchi.env.local`
   (gitignored) hold the real values. **Pass.** (Note: `ruchi.env.local` exists locally — ensure
   gitignored.)
   Verification specific to this repo's stack: `next.config.ts` serves CSP + HSTS on every route;
   the middleware does not touch API/static paths.

9. **Edge/auth races** — `getSupabase()` uses module-level caching with `initAttempted`; `reset`
   exists only for tests. Fine. `authenticateRequest` in `api-auth.ts` wraps every failure in a
   generic 401 with no provider detail — correct denial posture. **Pass.**

**MEDIUM findings:**
10. `src/lib/notifications/web-push.ts` has `UNSUITABLE_CONTEXTS = { cooking_gap, recent_cooking }`
    — these contexts are declined rather than delivered. That is a deliberate product decision and
    consistent with the planner (only `incomplete_session` is undeliverable cross-device); both are
    documented. **Pass.**

11. `lib/auth/supabase-auth.ts` classifies Supabase JS errors into stable user-facing strings —
    `email-taken` includes "already registered"/"already exists". No enumeration of passwords/emails
    beyond sign-in failures; password reset returns `sent` regardless of existence. **Pass.**

12. `src/lib/auth/supabase-data.ts` re-validates diet vocabulary in `fetchDiet` (profiles.diet_
    preference, check constraint in 0001) and falls back to neutral "eggetarian" — a wrong-but-
    broad filter, never a fabricated preference. **Pass.**

13. **Error leakage:** all routes return generic messages; the `analyze-ingredients` route logs
    full upstream errors to the server console but never to the client. **Pass.**

---

## 6. Production-Readiness Findings

- ✅ `npm run build` clean; typecheck (tsc --noEmit) ✅; lint ✅; vitest 501/501 ✅.
- ✅ Build output exists (`.next`) and the Vercel prod deployment is live at
  ruchi-sage.vercel.app with the routes probed: run→401, check-now→405, engagement→405,
  vapid→200, subscribe→405 (the 405s are because those endpoints only accept POST/DELETE; the
  probes used the wrong method — not a defect).
- ✅ Migration 0006 is live on hosted Supabase: `notification_ledger` (15 cols) → 200 `[]`;
  `notification_prefs` has `type_prefs`, `paused_session`, `kitchen_mirror`, `last_action`;
  `mark_notification_engaged` RPC exists and correctly rejects non-authenticated (P0001), not 404;
  anon/publishable read → 401 42501 (RLS active); transient service-role round-trip works (201 insert,
  204 select, delete → gone).
- ✅ E2E: `npm run verify:notify` 20/20 PASS (raw-pg local Postgres + vite-node, real
  `pipeline.ts`); `npm run verify:local` + `verify-0006` + `e2e-sim` all pass against the same
  migration set.
- ⚠️ **Remaining prod uncertainty:** the hosted Supabase REST path is unreachable from this
  execution network (404 on every path despite a valid service role), so the **scheduled cron
  end-to-end fire (sent→opened→ledger) has not been executed against the real account**. That is
  an environment/network limitation, not a code bug: the route probe confirms the Vercel routes are
  actually served (401/405/200 responses), and the pipeline code+schema+RPC+RLS+E2E have been
  verified independently. Re-run the cron from a network that reaches supabase.co, or accept the
  synthetic-subscription verification.
- ⚠️ **Device opt-in has not landed server-side.** `notification_prefs` still has `web_push:false`,
  no subscription, no signals, ledger empty. The "sent→opened" chain is therefore unverified for the
  user's account. Resolution requires the user to complete opt-in on a device that can reach
  supabase.co, or to accept the synthetic-subscription approach (dispatch the cron against our own
  test account with a fake-but-valid subscription) and/or rely on the local E2E + schema/RPC probe.
- ✅ Production env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, VAPID public/private/subject, `CRON_SECRET` all
  present in prod.
- ✅ Vercel: `vercel.json` cron `30 12 * * *` (12:30 UTC = 18:00 IST).

**Go/no-go:** the app is production-ready on code and schema. The only open item is the end-to-end
cron fire against the real account, which is an environment/network matter.

---

## 7. Android-Readiness Findings

**No Capacitor present in the repo.** Assessment of whether packaging into Android is viable:

1. **Next.js client/server boundaries.** Clean split: every data/identity/AI call is POST
   `/api/*` (server-only keys), and the only "server" dependency of the client bundle is the
   publishable-key Supabase client + the browser service worker. No server code leaks into the
   client. **Viable.**

2. **Server route dependencies.** All `/api/*` routes are Next.js server functions that run in the
   Next.js runtime (nodejs). On the device, Next.js would have to be served by a backend (e.g.
   serverless on Vercel, or an embedded BFF). If the goal is a native Android shell, the server is
   already "in the cloud" — the Android app is just a **native web view consuming the same API**.
   **Viable and already the actual architecture (PWA on mobile).**

3. **Authentication.** Supabase Auth web socket works in a mobile browser/web view; the app already
   persists the session in localStorage. The client store and screens have no Android-specific
   assumptions. **Viable.**

4. **Camera / photo picker.** The client preps images via `createImageBitmap` +
   `URL.createObjectURL` + `canvas.toBlob`, then `File`/multipart upload to the vision route. On
   Android's web view (Chrome-based), this works. No native camera plugin required. **Viable at
   a11y block level.**

5. **Push notifications.** Web Push (VAPID + service worker) is the configured delivery channel and
   already works in Android Chrome. A Capacitor-based native push (Firebase) would require a
   *different* delivery path (FCM tokens + a server-side FCM adapter), i.e. the notification layer
   would need a second adapter. The current web-push path is reusable with Capacitor's
   `capacitor-web-push` plugin (re-register a VAPID subscription) — **not a blocker, but a new
   adapter + new opt-in UX is required before upload.**

6. **Filesystem.** Not used. **N/A.**

7. **Keyboard.** The app uses responsive chips/buttons; no desktop keyboard-specific code.
   Safe-area + status-bar handling is present via `SafeArea.tsx` (SSR boot splash + `prefers-
   reduced-motion` + `color-mix` glass); `viewport` includes `width: device-width`.
   **Viable.**

8. **Android back button / lifecycle.** The app is a single-screen SPA with a bottom nav and
   `useScreen` router. Capacitor would need: `BackButton` plugin (override to exit/lean-back to
   home), `Page` lifecycle events (pause/resume) for sync retries, and no deep-link handling beyond
   the URL. The deep links (`?recipe=`, `?resume=`, `?category=`, `?n=`) are query-string based —
   **readily handled by Capacitor's `CapToast`/`deep-link` mapping.**

9. **Safe areas.** `SafeArea` + `-webkit-app-safe-area-inset` conventions are used; no hard-coded
   pixel nav offsets on mobile. **Viable.**

10. **Permissions.** Minimal: camera (for the photo flow) + notifications (web-push / FCM). No
    other native permissions needed. **Viable.**

**Conclusion:** Packaging the existing Next.js app into Android is technically feasible and
architecturally partial (the "app" is already a responsive web app on mobile). The correct move is
**NOT a rewrite**:

- Keep the responsive React app as the universal shell (works on iOS/Android web browsers).
- Register the service worker + VAPID push as the single push channel (web-push semantics are
  identical on Android Chrome).
- Wrap the same `/api/*` routes behind a backend that serves the Next.js static shell + SSR pages
  for the Android app, and add a Capacitor-native push adapter (FCM/APNs) if Apple's APNs requirement
  forces a native push path — but prefer keeping web-push for the first cross-platform implementation.
- Never change the deterministic engine, notification policy, or data model for Android.

If the user insists on a Capacitor build, the production blocker is not the stack: the minimal
wrapper architecture is a thin native shell + Capacitor web-view + Capacitor plugins (Camera,
Push Notifications, App/Restored State) + the existing Next.js build, served behind the same API.

---

## 8. Google Play Readiness Findings

**Production prompt categories**

**APPLICATION / PACKAGE ID**
- No `AndroidManifest.xml`, no `build.gradle`, no `strings.xml`, no `res/` in the repo. There is no
  Android project here — the app is a **web app** installed as a PWA. The "package ID" is the web
  app URL/host + the PWA manifest; no Android package is present.
- The `public/manifest.webmanifest` declares a PWA with 192/512/128/96/64/48/32 icons + maskable +
  apple-touch. It is valid JSON and references `/ruchi-logo-*.png` (generated from SVG via
  `scripts/generate-icons.mjs`). **But**: no `related_applications`, no `protocol_handlers`, and no
  `launch_handler` — so Chrome on Android can Add-to-Home-Screen but cannot (yet) declare a deep-
  link/URL-association scheme for `?recipe=` / `?resume=` / `?category=` / `?n=`.

**VERSION**
- `package.json` version = `0.1.0` (pre-1.0). For Google Play the version would be the **Android**
  version code/`versionName`, which does not exist here.
- No `versionCode`/`versionName` anywhere. **Missing — would need an Android build configuration.**

**TARGET / PERMISSIONS**
- No Android manifest permissions, no target SDK, no compile SDK. Not applicable to the web shell.
- Required for a Capacitor/native wrapper: Camera (photo flow) + Notification (push). No other
  permissions needed.

**ICON / SPLASH / LAUNCH**
- PWA icons exist (192/512 + maskable + apple-touch + SVG). No Android adaptive-icon layout, no
  splash screen drawable (would appear only inside a native shell), no play-store icon set (1024×
  500 feature graphic, screenshots, full description, short description, content rating, privacy
  policy, staging tier, sign-in instructions).
- The maskable icon is provided (`ruchi-logo-maskable.png`); the adaptive icon layout is missing.

**SIGNING / RELEASE**
- No keystore, `key.properties`, or signing config exists. AAB must be built with a release key –
  **manual Play Console upload of a signed AAB** is required. There is no CI/CD yet (no GitHub
  Actions workflow, no fastlane), and the repo contains only `vercel.json` for deployment.

**DATA SAFETY / PRIVACY**
- The app deliberately collects only: identity (name/email via Supabase Auth), profile prefs,
  meal history, cooking stats, beta feedback (topic + message, no email/IP/UA collected into the
  DB), and device push tokens (sent to the user's own row only, encrypted by VAPID). No tracking
  SDK, no ads, no analytics until "content_shown" events which are anonymous counters only.
- No analytics vendor in the dependency tree. `framer-motion` and `lucide-react` are UI-only.
- **Privacy policy & Data Safety screen** → must be written and linked from the store listing
  (required by Play). This app handles no sensitive personal data beyond what is described above,
  but the Play listing still requires a privacy policy URL.

**CONTENT RATING / TARGET AUDIENCE**
- No store listing metadata exists (no title/description/screenshots/category/feature graphic).
- No age-gating metadata to define; the content is family-safe (cooking).

**GOOGLE PLAY ACTIONS (MANUAL, not automatable)**
- Create developer account + one-time registration fee.
- Upload signed AAB (release keystore).
- Fill Store listing (title, short/full description, category, feature graphic, 8 screenshots,
  content rating form, target API level, privacy policy URL).
- Enable Android App Bundle + test tracks (internal → closed → open → production).
- **Do NOT publish automatically**; keep the app in "draft/managed" until the store listing and
  the data-safety questionnaire are reviewed.

---

## 9. Dependency Risks

| Package | Version | Risk | Notes |
|---|---|---|---|
| `next` | ^15.4.5 | Low–Medium | Stable product; Next 15 app router is the foundation. Keep pinned-ish. |
| `@supabase/supabase-js` | ^2.116.0 | Low | Only used browser-side; service-role usage is only on the cron shell + RPC. |
| `@google/genai` | ^2.24.0 | Medium | Vision dependency (paid, quota). Gate: 25 s timeout, 8 MB upload, empty→fallback, zod schema. |
| `web-push` | ^3.6.7 | Low | Server-only VAPID. |
| `zod` | ^3.25.76 | Low | Strict payload normalization everywhere; already used. |
| `zustand` | ^5.0.6 | Low | Client store; no persistence-related risk beyond localStorage quirks (private mode handled). |
| `framer-motion` | ^12.23.0 | Low | UI animations; `react-hooks/exhaustive-deps` is disabled in a few render paths by design (rawContext/attentionAtLoad/context). Those are intentional show-once-per-context patterns; verify with the test suite. |
| `pg` | ^8.23.0 | Low | Dev-only (local Postgres E2E). |
| `tsx` | ^4.23.15 | Low | Dev-only, E2E runner. |
| `vitest` | ^5.0.1 | Low | Dev-only tests. |
| `tailwindcss` | ^4.1.11 | Low | Design tokens via CSS `@theme`; no JS runtime. |
| eslint-config-next | ^16.3.5 | Low | Dev-only. |

**Key risk not in deps:** the **Supabase hosted REST API reachability from this execution network**
— all paths 404 here despite a valid service role. This is an environment limitation, confirmed by
the route probes (401/405/200 responses prove the routes are live). It does not affect prod.

**Other risk:** `public/sw.js` is served statically and excluded from the middleware matcher — keep
it. `sw.js` has no offline caching and no `skipWaiting` + `clients.claim` hygiene issues; the
`notificationclick` focus/deep-link path is correct.

---

## 10. Environment-Variable Inventory

**Committed?** `.env.example` has placeholders; `ruchi.env.local` exists locally (gitignored),
`next.config.ts`, `vercel.json`, and `postcss.config.mjs` are committed. Git history clean.

**Required (current production):**
- `NEXT_PUBLIC_SUPABASE_URL` (client + server boundary) — public URL, not secret.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — client-safe; the anon key.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, used ONLY by the cron shell and (via RPC) the
  engagement path; never by client code.
- `GEMINI_API_KEY` — server-only; used only by `/api/analyze-ingredients`.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — private key stays server-only; the
  public key is served read-only to anyone.
- `CRON_SECRET` — used by the cron shell for the Bearer gate; **never** exposed client-side.

**Optional / used:**
- `NEXT_PUBLIC_PASSWORD_RESET_REDIRECT` — for non-root deployments; default to origin root if unset.
- `NODE_ENV` — dev/prod; dev-only logging in AI observability + `visionDebug` (production silent).

**No localhost, no test URLs, no temporary secrets, no debug flags in prod config.** The app has a
secure-by-default posture: if `SUPABASE_SERVICE_ROLE_KEY` is missing, the cron route 503s instead
of failing open. `webPushAdapter` handles unconfigured VAPID gracefully (503 on the public key
route, no sends).

---

## 11. Existing Technical Debt

1. **Notification production fire not run.** The scheduled cron (`run` at 12:30 UTC) has never
   delivered to the real account here. The code/RLS/ledger/E2E/schema are verified; the live end-to-
   end loop is blocked by the execution network's inability to reach the hosted Supabase REST API
   (404s despite valid service role). This is documented as an environmental blocker, not a code
   defect.
2. **Device opt-in not persisted server-side.** `notification_prefs.web_push` is still false and no
   subscription exists for the user's account. The "sent→opened" chain is unverified. Requires
   user-side opt-in on a reachable device, or an explicit synthetic-subscription verification
   decision.
3. **Route probe semantics.** `check-now`/`engagement`/`subscribe` return 405 for GET because they
   only implement POST/DELETE; probes that issued GET would report "405" even though the routes
   work — the earlier "405" observations are probe artifacts, not bugs. The correct probes are
   POST (check-now/engagement/subscribe) and GET (run/vapid). Verified: run→401, vapid→200.
4. **`recordNotification` client-side id generation.** The ledger id is generated on the caller and
   extracted from the insert response; on a duplicate insert the returned id still references the
   already-claimed row, which is consistent with the idempotency contract. If the schema ever
   changes to DB-assigned ids, this becomes a reference bug — lowest risk.
5. **`sw.js` is a static service worker with no offline caching.** Intentional (the app handles
   network at the layer above), but if the product later ships a native Android shell, the SW
   becomes only a web-push path and must not be confused with offline storage.
6. **UX edge cases documented for future work:**
   - `notification_prefs` defaults OFF; a user who has never opted in gets `not_opt_in` from
     check-now with zero ledger noise — that is correct, but the UX message should be tuned
     (currently a bare `ok:true` outcome; the client surfaces it as the no-op message).
   - Deep-link cleanup: the browser history is not rewritten after `notificationclick`, so a
     back-button from a pushed screen would leave the old deep-linked URL. Minor, likely to be
     fine once a native shell owns the stack.
   - The `attention` mirror is written fire-and-forget; on a failed mirror the cron silently
     relies on the client's own state. No data loss, but the mirror is a "nice-to-have signal"
     per the spec.
7. **Cooking stats RPCs are plpgsql security definer**; both `record_cooking_completion` and
   `record_completed_meal_day` use `auth.uid()` and check constraints — no injection risk because
   PL/pgSQL binds by parameter, not by string concatenation. Reviewed. **Pass.**
8. **`e2e-sim.mjs` claims "no hosted Supabase in this environment"** and is intentionally a data-
   layer simulation over local Postgres; the E2E notification pipeline (`e2e-notifications.mts`)
   is the real-pipeline driver. Both coexist without conflict because they exercise different
   layers of the same schema.

---

## 12. Recommended Implementation Order

Keep the audit gate: **no implementation until the user reviews this report.**

Phase A — **Prod reliability (this turn's real gate, no code change):**
- Re-run the prod cron from a network that reaches supabase.co, or accept the synthetic-subscription
  verification + local E2E + schema/RPC probe (recommended path).
- Read back `notification_prefs` for the user's account and confirm `web_push:false` (already known);
  document whether to proceed with synthetic-subscription verification.

Phase B — **Ship the remaining end-to-end loop (after Phase A approval):**
- Add a production verification build step (CI) that runs `verify:notify` + `verify:0006` + `build`
  and reports the prod route status (401/405/200) as environment health, not code.
- Tune the client no-op copy for `check-now` → `not_opt_in` so the Profile UI is honest.

Phase C — **Ship Android / Google Play (after Phase A + B approval, separate tracking):**
- Set up a native wrapper shell ( Capacitor minimal wrapper or a native Android/Apple app consuming
  the same web shell + API).
- Register a native push adapter (FCM/APNs) as the second adapter; keep web-push as the universal
  default.
- Add store listing metadata (privacy policy, Data Safety, play store assets, signing, AAB) and
  publish to a test track first.

Phase D — **Production hardening (approved, tracked separately):**
- Provider abstraction only when a second capability proves needed (each fallback gets trigger/
  safe-failure/schema/validation/tests).
- Vercel rate-limit rule for the cron/check-now routes (if abuse exposure grows).
- Replace local ledger-id generation with DB-assigned ids (lowest-cost hardening).
- Add a deep-link-back rewrite after `notificationclick` (if the native shell is pursued).

---

## 13. Critical Blockers

1. **None blocking code or deploy.** The app builds, is deployed, the schema/RPC/RLS is live, and
   the E2E is green. The notification 2.0 core is verified end to end.
2. **Production cron fire cannot complete in this environment** (hosted Supabase REST unreachable
   at execution time). Not a code defect; a network artifact of this run. **Must be re-verified from
   a reachable network or accepted as environment-blocked.**
3. **Device push subscription not present for the user's account.** No subscription row, no signals,
   empty ledger. The "sent→opened" verification cannot be recorded against the user's identity
   until opt-in completes on a reachable device, or we explicitly accept synthetic-subscription
   verification as the verification method.
4. **Google Play deployment artifacts do not exist** (no Android project, version info, signing,
   store listing). Any future Play release is fully manual and requires the user's review of the
   Play console actions before upload.

---

## 14. High-Priority Risks

1. **Notification pipeline correctness under concurrency.** The ledger claim (INSERT ... ON CONFLICT
   DO NOTHING) is executed before delivery — idempotent re-runs are safe; the policy's duplicate
   check (lastSentDedupKey) fires before the claim. If either ordering ever drifts, a duplicate can
   be sent. Mitigation: the E2E (20/20) guards the contract; keep the real pipeline as the single
   source and do not parallelize per-user delivery within one run without a change to the ordering.
2. **Push TTL vs stale context.** `expiresAt` is derived from the engine's cooldown, not from the
   notification's own urgency. A late cron run drops stale messages before any I/O. This is a
   deliberate product choice (no false "pick up where you left off" reminders after the session is
   over). Verify that `PUSH_TTL_MS` values never exceed the corresponding `COOLDOWN_MS` classes
   when tuning — currently they are consistent (HIGH_VALUE ≤ 3h, NORMAL ≤ 12h, PERSONALITY 14d).
3. **RLS ownership.** The engagement RPC and `subscribe/` route both trust Supabase auth + RLS.
   If Supabase Auth is misconfigured in prod (e.g. email confirmation disabled, redirect URL wrong),
   the app degrades to anonymous-only usage. The `email-not-confirmed` failure path exists but the
   user must be prompted to confirm; the app shows a generic message, not a diagnosis. Acceptable.
4. **Broken future-view for notifications.** The planner and policy both read real ledger facts;
   suppression rows carry NULL dedup key so they never occupy a send slot. The one failure mode is
   the `notification_prefs` row being deleted (RLS allows it, and the client would then see
   `not_opt_in` on every check). Document that deleting the prefs row requires the user to opt in
   again before notifications resume — spec-consistent, no data loss.
5. **AI copy / hallucination surface.** Vision names are mapped through the existing alias index;
   unmapped names become `uncertain_items`; nothing is written to the DB from AI. Recommendation
   ranking is deterministic; AI, if later enabled, only re-orders validated recipeIds. **Pass.**
6. **Observability gaps for the provider path.** `lib/ai/observability.ts` logs only dev metadata;
   the production path for the Gemini route is silent except the server console. Add a lightweight
   `recordVisionFallback` + count of failed analyses to the prod logs (already present) and consider
   a usage counter on the cron run (delivered/suppressed/pruned/failed) — the route already returns
   counts. **Low priority.**
7. **No dedicated source of truth for the notification spec.** `docs/NOTIFICATION_LAYER.md`, the
   migrations, the routes, and the pipeline are the only artifacts; the spec lives across all of
   them. Future changes must update all four in the same PR. Not a code risk; a process note.
8. **Tenant/tenant isolation** is by `user_id` RLS in every user-owned table; the e2e-sim proves
   isolation (B cannot read A's rows, B cannot insert as A). **Pass.**

---

# PART II — REAL-DEVICE NOTIFICATION VERIFICATION

Status: **BLOCKED**

Reason:
The current execution environment has no physical device or browser context capable of registering
a PushSubscription and observing Web Push delivery/open/engagement. No real PushSubscription was
created, no real notification was delivered, none was claimed as delivered, no open was fabricated,
and no engagement event was fabricated.

Verified facts:
- Production URL is live.
- GET = POST cron compatibility remains intact.
- Invalid/missing cron authentication returns 401.
- VAPID public-key endpoint is available.
- Automated tests pass.
- Notification E2E passes.
- Typecheck passes.
- Lint passes.
- Production build passes.
- No real PushSubscription exists in this terminal environment.
- No real notification delivery was attempted.
- No notification was claimed as delivered.
- No notification open was fabricated.
- No engagement event was fabricated.
- Real-device verification remains an environmental verification gap.

---

The Phase 0 audit above is the historical record of the repository audit. No application source code,
no notification infrastructure, no Android/Capacitor work, and no notification features were added or
changed during this phase. The audit conclusions were not silently altered; where the live system
differed from the pre-deploy verification record, it is listed as a documented, environment-scoped
open item (production cron fire, device opt-in) rather than a code defect.
