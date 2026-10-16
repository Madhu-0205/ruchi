# Image scanning — provider architecture

## What RUCHI scans with today

Ingredient photo scanning is implemented as a provider-agnostic service contract
(`IngredientVisionService` in `lib/ai/types.ts`), with exactly one implementation:

- **`GeminiIngredientVisionService`** (`lib/ai/vision.ts`) — sends the
  preprocessed photo to `POST /api/analyze-ingredients`, which calls Google
  Gemini (`gemini-2.5-flash`) via `@google/genai` (v2.24.0) server-side.

The client never holds a provider key. The server route:
- authenticates the caller via Supabase session (`lib/auth/api-auth.ts`);
- requires `GEMINI_API_KEY` on the server;
- enforces a 25 s timeout, 8 MB upload cap, MIME/type/size checks, and a Zod
  schema on the model output;
- returns `{ ingredients: string[] }` or an error code.

Mapping model names onto RUCHI's canonical ingredient catalog happens client-side
through the existing alias index (`findIngredient` / `byAlias`), the same index
the manual "I have…" text parser uses. Unmapped names surface as `uncertain`
rows the user confirms — the model cannot invent catalog ingredients.

## Why scanning can fail with this setup

Every failure becomes the honest text fallback ("I have…"). The current failure
surface is real and expected for a server-backed, paid, login-gated AI provider:

1. **Server API key not configured** — `/api/analyze-ingredients` returns 503
   (`not-configured`). The client shows the scanner-unavailable fallback.
2. **Signed-out user** — the route returns 401 (`unauthorized`). Treated as
   scanner unavailable; the user can still type ingredients manually.
3. **Network / timeout / rate limit / safety block on the Gemini call** —
   502/504/429 from the route → scanner unavailable or busy.
4. **Empty or malformed model JSON** — empty ingredients list or invalid JSON →
   explicit "couldn't spot any ingredients" message, never a fake result.
5. **Client-side network failure reaching the route** — `fetch` throws (offline,
   blocked, DNS, etc.) → now surfaced as a "that didn't go through" network
   message rather than a generic "couldn't read the photo".

The service (`lib/ai/vision.ts`) resolves `null` for every one of these (that is
the `IngredientVisionService` contract — callers never crash), but it also
records the fine-grained reason via `recordVisionFallback` (`network` /
`auth-required` / `server-error` / `no-ingredients-detected` / `provider-error`).
The scan screen reads `getLastVisionFallback()` and classifies with
`classifyVisionError` (`lib/ai/errors.ts`), so the message matches the real
cause instead of blaming the photo. Model names the catalog could not map
(`analysis.uncertainItems`) are turned into confirmable rows by
`visionAnalysisToRows` (`lib/ai/scan.ts`) — they are shown for user confirmation,
never silently dropped.

The preprocessing, image-to-catalog mapping, and schema validation are not the
failure point — those are exercised by tests. The failure point is the live,
server-side, paid AI call.

## What this means for "unable to scan or read the image"

The message "I was unable to scan or read the image" is not a preprocessing or
parsing bug. It is the documented fallback for:

- the server route being unreachable from the client (network, offline, blocked,
  or the route itself failing);
- the route being configured but the provider call failing;
- no ingredients being identifiable in the photo.

The UI now distinguishes client-side network failures from "nothing found" vs
"scanner unavailable", so the user sees an honest message instead of a generic
"couldn't read the photo" for every failure.

## Why a free/open-source path is not already in place

RUCHI's AI layer is provider-agnostic by design, but the **only implemented
vision provider today is Gemini**. There is no currently running open-source or
self-hosted vision model in this codebase. An open-source model is not something
that can be enabled by flipping a config flag — it requires a real inference
backend that can accept an image and return structured ingredient labels.

## Proposed open-source/self-hosted vision path

If the goal is scanning without a paid, login-gated third-party AI service, the
provider-agnostic `IngredientVisionService` contract already supports swapping
the implementation. The engineering task would be:

1. **Choose an open-source vision model** that can do ingredient/object
   recognition from a single photo and return structured labels. This is a model
   selection and licensing decision — e.g. an open-weight vision model — separate
   from hosting.
2. **Host an inference backend** that accepts the image and returns
   `{ ingredients: string[] }` in the shape the client already expects. This is
   the part that costs something: a running service, GPU or serverless inference,
   model weights, and ongoing uptime. It is not free just because the model
   weights are open.
3. **Implement a new `IngredientVisionService`** in `lib/ai/vision.ts` (or a new
   file) behind the same contract, so the rest of the app does not change. The
   existing `getVisionService()` factory in `lib/ai/index.ts` is the swap point.
4. **Keep the existing guardrails**: catalog fencing via `mapToAnalysis`, schema
   validation of whatever the backend returns, uncertainty for unmapped names,
   and the manual fallback when the backend is unavailable.

The current Gemini route already defines the shape the app consumes. Any
replacement backend must honor that shape or the client must grow a thin adapter —
the app is not coupled to Gemini except through `GeminiIngredientVisionService`
and the server route.

## Constraints this path must respect

- No user login to a third-party AI service. The backend may use a service API
  under the hood, but the user does not authenticate to it.
- No fabricated results. An open-source model can still mislabel; the catalog
  fencing and uncertain-item confirmation must stay in place.
- No client-side model runtime pretending to be "local" unless the app actually
  runs one. A browser-side WASM/TF.js vision model is a real engineering project,
  not a config change, and would need its own implementation behind the same
  contract.
- Honest failure handling. An open-source backend still fails — offline, overloaded,
  misconfigured — and the UI must still fall back honestly.

## Recommendation

If scanning is required to work without a paid Gemini key, the smallest honest
next step is to stand up a separate open-source vision backend behind the existing
`IngredientVisionService` contract and route, then keep Gemini as a
fallback/default provider until the replacement is proven. The application code
is already structured for that swap; the missing piece is the backend and model.
