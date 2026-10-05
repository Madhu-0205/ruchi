# Architecture Model — RUCHI (Phase 1 work product)

This file documents the application architecture and trust boundaries for the
full-stack security audit. It is a snapshot of the committed state; it is not a
recommendation to change the design.

## Application architecture

- **Frontend framework**: Next.js 15 (App Router) + React 19 + TypeScript
  (`strict`), Tailwind CSS v4, Framer Motion, Zustand, Lucide.
- **API architecture**: Next.js server routes (`src/app/api/*`) + edge
  middleware (`src/middleware.ts`). No separate BFF, no GraphQL, no RPC
  gateway.
- **Serverless / edge**: Next.js route handlers run in the Next.js runtime
  (`runtime = "nodejs"` on the AI route). Middleware is the only edge-shaped
  layer.
- **Background workers / queues / schedulers**: one cron entry in
  `vercel.json` (`/api/notifications/run`, schedule `30 12 * * *`); no queue
  infrastructure, no workers, no Rabbit/Kafka/SQS.
- **Authentication provider**: Supabase Auth (email/password). No OAuth,
  magic links, MFA, or social sign-in in this build.
- **Database**: Supabase (Postgres) with RLS. User-owned tables:
  `profiles`, `completed_meals`, `cooking_streaks`,
  `cooking_completions`, `cooking_stats` view, `beta_feedback`,
  `notification_prefs`, `notification_ledger`.
- **Object/file storage**: none in the app. Static assets live in `public/`
  (icons, `manifest.webmanifest`, `sw.js`). No upload bucket, no S3.
- **Caches**: client `localStorage` (zustand persist), in-memory analytics
  buffer, and in-app content-rotation memory. No CDN edge cache, no Redis.
- **External APIs**: Supabase REST API (browser + service role), Google
  Gemini (`@google/genai`, server-only), WebPush (VAPID, `web-push` npm
  package, server-only).
- **AI/LLM**: Gemini 2.5-flash via `POST /api/analyze-ingredients` (image
  vision only). Recommendation ranking and cooking assistant are
  deterministic-only today; AI is a service, never the authorization
  boundary.
- **Analytics**: local JSON buffer (console in dev only); no vendor SDK.
- **Payments**: none.
- **Email/SMS**: none live. Password reset uses Supabase Auth
  `resetPasswordForEmail` + redirect URL.
- **Webhooks**: none.
- **CI/CD**: none (no `.github/workflows/`). Deployment = Vercel (`vercel.json`
  only). Android is only a Capacitor shell target.
- **Cloud / deployment**: Vercel hosting (`ruchi-sage.vercel.app`), hosted
  Supabase project `gnsyvkcabegdzhqbpqyy.supabase.co`.

## Trust boundaries

| Boundary | Trust change |
| --- | --- |
| unauthenticated → authenticated | Supabase Auth session establishes identity; app then gates UI (`deriveAuthFlowState`), no data renders until `account` is set |
| user → application | Supabase Auth is the only authority; `authenticateRequest` verifies the session Bearer server-side |
| browser → API | Bearer token (session JWT) per route; object ownership additionally enforced by RLS |
| frontend → backend | Server routes validate tokens; `serviceRole` usage is restricted to the cron shell and DB RPCs |
| backend → database | RLS + `auth.uid()` policies; `SECURITY DEFINER` RPCs re-check `auth.uid()`; views use `security_invoker` |
| backend → third-party | VAPID private key and `SUPABASE_SERVICE_ROLE_KEY` are server-only env |
| web → application | SPA hard-307 to `/` for deep paths (excluded `api`, `_next`, `sw.js`, manifest, icons) |
| worker/database → database | No DB worker. Cron runs on Vercel serverless; service-role bypasses RLS intentionally |
| admin → privileged functionality | No admin UI; moderation is dashboard-only; no privileged RPC in the app surface |
| tenant/user → another tenant/user | RLS-scoped reads/writes; service-role reads are the only cross-user path and is cron-only |
| AI/LLM → application | Vision feed is read-only; `GEMINI_API_KEY` never reaches the browser |
| external URL → application | Password-reset redirect is Supabase-allow-listed; no open redirect logic in the app |
| uploaded file → processing pipeline | Photo is client-preprocessed, multipart to server vision route; validated image/JPEG/PNG/WebP, size bounds, timeout |

## Attack surfaces

- **HTTP routes**: 7 product endpoints under `/api`:
  - `analyze-ingredients` (POST) — Gemini vision, auth-gated.
  - `notifications/run` (POST + GET) — Vercel cron target; `CRON_SECRET`
    Bearer gate; service-role client.
  - `notifications/check-now` (POST) — token-guarded user-initiated pipeline.
  - `notifications/vapid-public` (GET) — public VAPID key, `no-store`.
  - `notifications/subscribe` (POST/DELETE) — push subscription in own row.
  - `notifications/engagement` (POST) — `mark_notification_engaged` RPC.
- **RPC endpoints**: `record_completed_meal_day`,
  `record_cooking_completion`, `mark_notification_engaged`,
  `validate_notification_type_prefs` (trigger).
- **Server actions / GraphQL / WebSockets**: none.
- **Background jobs / cron**: `POST/GET /api/notifications/run` (Vercel Cron).
- **Admin endpoints**: none.
- **Internal endpoints accidentally exposed**: none.
- **Client-side**: Supabase REST (user JWT), service worker `sw.js`
  (`push`/`notificationclick`), localStorage keys (`ruchi.store.v1`,
  `ruchi.analytics.v1`, `ruchi.content.v1`, `ruchi.deeplink`).

## Data flow summary

1. User adds ingredients → client state → optional mirror to
   `notification_prefs.kitchen_mirror` (fine-grained RLS).
2. Recommendation / policy / opportunity pipeline is deterministic and
   server-side (`opportunities.ts` → `policy.ts` → `copy.ts` →
   `planner.ts` → `web-push.ts` → `ledger.ts`).
3. Cron (`run`) selects opted-in users, runs `processUser` per row, claims a
   ledger row by unique `(user_id, dedup_key)`, delivers via WebPush adapter,
   settles status, mirrors attention.
4. Engagement is only writable through the SECURITY DEFINER RPC
   `mark_notification_engaged`, which gates ownership by `auth.uid()`.

## Trust boundary checkpoints

- **anon → authenticated**: Supabase Auth session is created only by Supabase
  sign-in flows; the app never accepts a client-supplied user id for
  ownership.
- **user → application**: every RLS table checks `auth.uid()`; the
  service-role key is never exposed to the browser.
- **browser → API**: all user-scoped routes verify the session JWT via
  Supabase Auth server-side.
- **backend → database**: RLS + `SECURITY DEFINER` RPCs; views are
  `security_invoker`.
- **backend → third-party**: only `web-push` and Gemini are reachable, both
  server-only.
