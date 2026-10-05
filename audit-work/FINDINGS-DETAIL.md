# Findings Detail

## F-001 — check-now returns a product-specific enrollment status
**Severity:** Low · **Verdict:** CONFIRMED

### 1. Vulnerability description
`POST /api/notifications/check-now` does not honor one authentication
contract. Unauthenticated or unauthenticated-with-invalid-token callers do
not get a clean 401; they get 503 or a no-op whose payload carries product
meaning.

### 2. Root cause
The route validates `Authorization` before calling `getUser()`, but it does
not funnel a missing/invalid/malformed header through one 401 response.
When the token is fine but there is no prefs row, the handler returns
`{ ok: true, outcome: "not_opted_in" }` — a product-grounded state rather
than a uniform denial.

### 3. Exact source location
- `src/app/api/notifications/check-now/route.ts`
  - POST starts with token extraction and `supabase.auth.getUser(token)`.
  - `if (userErr || !user) → 401` exists for rejected tokens.
  - Missing `Authorization` header is not explicitly checked; the handler
    reaches the service-creation path and can respond 503.
  - Row absent → `{ ok: true, outcome: "not_opted_in" }`.

### 4. Relevant code path
```
POST /api/notifications/check-now
  → token extracted from Authorization
  → supabase.auth.getUser(token)  → 401 on rejected
  → select own row (user_id from token)
  → no row → { ok: true, outcome: "not_opted_in" }
```

### 5. Attacker-controlled input
`Authorization` header (any value) + an empty/invalid request body.

### 6. Trust boundary crossed
Browser/API authentication boundary. RLS does not come into play because
the route performs a read of the caller's own row; the gap is the response
protocol, not data isolation.

### 7. Exploitation conditions
Probe the endpoint with a missing or malformed Bearer token. A clean
implementation must return 401 in every such case; this one returns 503 or
a no-op.

### 8. Security impact
Low. No data exposure, no authorization bypass, no information disclosure
about another user. It weakens observability and makes the endpoint behave
differently from the rest of the API surface.

### 9. Existing mitigations
- Every row selection is scoped to `user_id` from the verified token
  (`.eq("user_id", user.id)`).
- The pipeline itself is rate-limited/capped in policy.

### 10. Why mitigations are insufficient
The mitigation is scoped to the data path, not the response contract.
Observability and clear denial still fail for a missing header.

### 11. Recommended remediation
- Share one `authenticateRequest`-style helper across all `/api` routes.
- Return 401 for missing/invalid tokens; return 404/409 only for product
  states with stable codes.

### 12. Regression-test recommendation
- Call every user-scoped route with no header, with a malformed header,
  and with a revoked token; assert `401` in all three.
- Call with a valid token and no prefs row; assert `404` or a documented
  409 with no product-specific status.

---

## F-002 — deep-link landed by notifications is read only in the browser
### 1. Vulnerability description
Notification deep links (`?n=`, `?recipe=`, `?resume=`, `?category=`) are
read client-side and drive routing/targeting; there is no server-side
validation that a URL target matches the session or the notification's own
destination.

### 2. Root cause
`src/lib/notifications/deep-link.ts` consumes query-string params at mount
and calls the store's router. The engagement mutation is RLS-secured by the
RPC, but the deep-link state machine is purely client-side.

### 3. Exact source location
- `src/lib/notifications/deep-link.ts`, `readOnce`/`applyDeepLink`.

### 4. Relevant code path
```
URL ?recipe=x or ?n=ledgerId → readOnce client-side → useScreen.go →
/markNotificationEngaged (RLS-secured RPC)
```

### 5. Attacker-controlled input
Crafted URL with `?n=<ledgerId>`, `?recipe=<id>`, `?resume=<id>`,
`?category=<id>`.

### 6. Trust boundary crossed
Navigation/client-input boundary. The security-sensitive part (ledger
mutation) is on the RPC and is own-row RLS.

### 7. Exploitation conditions
In-browser only, for the routing side. The ledger side is already
guarded. Whether a crafted URL can trigger anything beyond navigation is
unverified here because hosted Supabase REST is unreachable in this
environment.

### 8. Security impact
Unresolved. The confirmed part is that URL-derived navigation is
client-side; the impact depends on reachability and on a native-shell
deployment decision.

### 9. Existing mitigations
- `mark_notification_engaged` enforces own-row ownership via RPC.
- The URL is consumed once per load and remembered in sessionStorage.

### 10. Why mitigations are insufficient
None of the mitigations protect the URL-derived navigation from being
driven by a crafted link; that is expected at the browser layer.

### 11. Recommended remediation
- Keep deep-link handling read-only for navigation.
- Use the RLS-secured RPC for any ledger mutation.
- Do not assume URL routing is a security boundary.

### 12. Regression-test recommendation
- Verify the RPC still enforces own-row engagement after any navigation
  change.
- When a native shell ships, verify the URL is parsed and validated at the
  native layer, not only in the browser.

---

## F-003 — production cron fire never ran against hosted Supabase
### 1. Vulnerability description
The scheduled `/api/notifications/run` (Vercel Cron) has not been fired
against hosted Supabase in this execution network; the delivery →
opened chain is unverified.

### 2. Root cause
Environmental: hosted Supabase REST is unreachable from the execution
network at verification time. The route and pipeline are deterministic and
code-reviewed; no code defect exists.

### 3. Exact source location
- `src/app/api/notifications/run/route.ts`
- `vercel.json`

### 4. Relevant code path
```
vercel.json cron (30 12 * * *) → POST /api/notifications/run
  → CRON_SECRET Bearer gate → service-role select → processUser per row
  → ledger claim → web-push adapter → status settle
```

### 5. Attacker-controlled input
None (operator-only endpoint).

### 6. Trust boundary crossed
Ops/automation boundary.

### 7. Exploitation conditions
Requires a reachable Supabase project + a real opted-in user and a live
subscription. Not present in this audit environment.

### 8. Security impact
Unresolved — not a vulnerability. The app can reach the scheduled path, but
live verification requires production access.

### 9. Existing mitigations
- Route self-limits to a batch size of 200.
- Failure is a 500-shaped response, not a partial batch send.
- Local E2E simulates the same pipeline against Postgres.

### 10. Why mitigations are insufficient
They verify the mechanics, not the production end-to-end loop.

### 11. Recommended remediation
- Re-run the cron from a network that reaches the hosted Supabase project,
  or explicitly accept synthetic-subscription verification.
- Add a CI health check that reports route status as environment health.

### 12. Regression-test recommendation
- Schedule the route from a reachable environment and assert the JSON
  outcome + ledger rows.
- If production access is not available, document the loop as environment-
  blocked and verify via a reachable staging project instead.

---

## F-004 — device push subscription not persisted server-side
### 1. Vulnerability description
The account has no live push subscription, so the delivered→opened chain
for notifications is unverified.

### 2. Root cause
The deployment has no web_push channel enabled and no stored
`web_push_subscription` row for the user. This is an opt-in/user action,
not a code defect.

### 3. Exact source location
- `src/app/api/notifications/subscribe/route.ts`
- `src/lib/notifications/subscribe.ts`
- `src/lib/notifications/web-push.ts`

### 4. Relevant code path
```
Profile toggle enabled → browser registers SW + pushManager.subscribe →
POST /api/notifications/subscribe (own row) → store
```

### 5. Attacker-controlled input
None.

### 6. Trust boundary crossed
Push-delivery channel boundary.

### 7. Exploitation conditions
A real browser/device opt-in is required. This is an operational gap, not a
code vulnerability.

### 8. Security impact
Unresolved. Delivery parity is unverified, but the security model is not
compromised.

### 9. Existing mitigations
- `isValidSubscription` rejects malformed stored payloads.
- The plan layer counts real deliveries and never sends when there is no
  subscription.
- `check-now` is an honest no-op when the user never opted in.

### 10. Why mitigations are insufficient
They prevent misuse, but the normal delivery path has not been exercised
end-to-end with a real device.

### 11. Recommended remediation
- Complete device opt-in on a reachable device; or
- Accept synthetic-subscription verification explicitly; or
- Document the delivery gap as an operational blocker for Phase A.

### 12. Regression-test recommendation
- Register a real subscription and POST it to `/subscribe`; assert RLS
  scopes it to the caller.
- Fire the cron on a synthetic subscription; assert the ledger claim and a
  non-failed status.

---

## F-005 — AI/LLM front-end contracts are not production-enabled
### 1. Vulnerability description
No production LLM path exists to probe for prompt injection, tool abuse, or
secret exposure; the AI layer always falls back deterministically.

### 2. Root cause
`getRecommendationService()` and `getAssistantService()` resolve null,
and `aiConfigured()` returns false. The AI layer is a provider-agnostic
contract with safe fallback.

### 3. Exact source location
- `src/lib/ai/index.ts`

### 4. Relevant code path
```
getRecommendationService / getAssistantService → deterministic null
→ Home/Discover renders engine-only results
```

### 5. Attacker-controlled input
None.

### 6. Trust boundary crossed
AI integration boundary.

### 7. Exploitation conditions
None. There is no live AI surface.

### 8. Security impact
Unresolved. No attack surface exists today; classification requires the AI
goes live.

### 9. Existing mitigations
- Structured output validated with Zod before anything reaches the UI or
  store.
- Ingredient names map to the catalog or become uncertain rows the user
  confirms.
- Deterministic fallback is the default.

### 10. Why mitigations are insufficient
They address a future surface, not a current one.

### 11. Recommended remediation
When the AI surface is enabled, add tool authorization at the final action
boundary and keep output validation. Until then, this is a hardening note,
not a finding.

### 12. Regression-test recommendation
- Assert `aiConfigured()` returns false and the app degrades to the
  deterministic engine.
- When the surface ships, add a fuzz-test harness for malformed AI
  payloads.

---

## F-006 — Android shell architecture not implemented
### 1. Vulnerability description
The Capacitor Android target is not shipped; no Android code path exists
for an attacker to reach.

### 2. Root cause
Out of scope. The repo contains a build-verified Capacitor shell target
(read from the remote URL), but it is not part of the current product
surface.

### 3. Exact source location
- `android/`
- `capacitor.config.ts`

### 4. Relevant code path
Native shell loads remote Next.js URL. No native API paths exist yet.

### 5. Attacker-controlled input
None.

### 6. Trust boundary crossed
Platform architecture.

### 7. Exploitation conditions
None.

### 8. Security impact
Unresolved. No Android code path exists.

### 9. Existing mitigations
- Web app is the security boundary and is RLS-secured.
- Android adds no new privileged RPCs; any native bridge would be new work.

### 10. Why mitigations are insufficient
They do not apply to a platform that does not exist yet.

### 11. Recommended remediation
When Android ships, add bridges behind the same RLS boundaries and keep
web-safe configuration.

### 12. Regression-test recommendation
- Build-verified Android target is already run (`gradlew clean
  assembleDebug` → BUILD SUCCESSFUL).
- Native-bridge additions must not expose new endpoints to the WebView.

---

## F-007 — Rejected: CSP blob: is not exploitable here
- **Verdict:** REJECTED
- **Rationale:** `img-src blob: data:` is required for the camera flow.
  No client code renders user-controlled content to `<img>`; there is no
  stored image, no blob-based XSS path, and the rest of the CSP is
  conservative.

## F-008 — Rejected: GET 405 on POST-only routes is a probe artifact
- **Verdict:** REJECTED
- **Rationale:** HTTP method restriction is correct and enforced. Probes
  that issued GET reported 405; the documented working probes were POST
  (check-now, engagement, subscribe) and GET (run, vapid). This is expected
  semantics, not a security defect.
