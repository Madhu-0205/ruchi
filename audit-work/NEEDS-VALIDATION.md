# Unresolved Candidates —needs validation

Every entry below is an **unresolved candidate only**. No severity is
assigned until the exact unresolved fact is resolved.

---

## NV-001 — production cron has never executed against hosted Supabase
- **Suspected issue:** live end-to-end notification delivery + opened chain
  unverified in production.
- **Source evidence:** `vercel.json` schedules `POST /api/notifications/run`
  at 12:30 UTC; route is `CRON_SECRET`-gated with a service-role client and
  self-limits to 200 rows. Executed verification could not reach hosted
  Supabase REST from this environment.
- **Unresolved fact:** Whether hosted Supabase REST is reachable from a
  production network and whether a real opted-in user + live subscription
  exists.
- **Why it cannot be confirmed now:** External network reachability +
  live account state can only be confirmed from a reachable environment.
- **Exact validation required:** Re-run the cron from a reachable network
  (or a staging project) with a real opted-in user and a real subscription;
  assert ledger claim + non-failed status. If not possible, accept
  synthetic-subscription verification or document the gap as an operational
  blocker.

---

## NV-002 — device push subscription not present on the account
- **Suspected issue:** the delivered→opened chain is unverified because no
  `web_push_subscription` row exists for the user.
- **Source evidence:** `notification_prefs.web_push=false` in the existing
  deployment; no live subscription exists for the account.
- **Unresolved fact:** Whether a real device/browser completed the
  `enableWebPush` flow.
- **Why it cannot be confirmed now:** Verification requires a live browser
  and the user's own device opt-in.
- **Exact validation required:** Run `enableWebPush` on a reachable device,
  confirm the subscription lands in the caller's own `notification_prefs`
  row, then fire the cron with the synthetic subscription.

---

## NV-003 — AI/LLM front-end contracts not production-enabled
- **Suspected issue:** no live LLM surface exists (no prompt injection or
  tool-abuse surface to validate).
- **Source evidence:** `getRecommendationService()` and
  `getAssistantService()` resolve null; `aiConfigured()` returns false.
- **Unresolved fact:** Whether the AI surface will ship, and under what
  authorization model.
- **Why it cannot be confirmed now:** The product is AI-degraded by
  design; classification depends on a shipping decision.
- **Exact validation required:** When the surface goes live, verify
  output validation + tool authorization at the final action boundary.

---

## NV-004 — Android shell not implemented
- **Suspected issue:** no Android code path exists for an attacker to reach.
- **Source evidence:** Capacitor 8.5.2 shell loads the remote URL; build is
  verified (`gradlew clean assembleDebug`).
- **Unresolved fact:** Whether the shell is shipped, and whether native
  bridges (deep-link, push, camera) will add new privileged paths.
- **Why it cannot be confirmed now:** Shipping decision and bridge work are
  product inputs.
- **Exact validation required:** When Android ships, profile every new native
  bridge against the same RLS boundaries and verify no new public endpoints.

---

## NV-005 — deep-link intent is not server-side enforced
- **Suspected issue:** `?n=`/`?recipe=`/`?resume=`/`?category=` are read
  client-side and drive navigation; no server-side validation ties the URL
  target to the session.
- **Source evidence:** `src/lib/notifications/deep-link.ts` consumes
  query-string params at mount and calls the store router; ledger mutation
  is RPC-secured, but routing is not.
- **Unresolved fact:** Whether any URL-derived behavior can influence a
  security-sensitive path outside the browser.
- **Why it cannot be confirmed now:** The URL path is client-side; the
  security-sensitive part is on the RPC. A native-shell deployment would
  change this.
- **Exact validation required:** Confirm the RPC still enforces own-row
  ownership independently of URL-driven routing. If a native shell ships,
  verify URL parsing and target validation at the native layer.

---

## NV-006 — route-contract inconsistency (check-now enrollment state)
- **Suspected issue:** `check-now` returns a product-grounded
  `not_opted_in` state instead of a uniform 401/404/409, so unauthenticated
  probes receive different feedback.
- **Source evidence:** POST handler returns `{ ok: true, outcome:
  "not_opted_in" }` when there is no prefs row; missing/invalid token paths
  are not funneled through one 401.
- **Unresolved fact:** Whether this must be fixed before the product ships.
  The confirmation in source is complete; the question is product priority.
- **Why it cannot be confirmed now:** No security property fails; the
  response contract is inconsistent but harmless.
- **Exact validation required:** Decide whether to standardize 401 vs
  404/409 across `/api` and add a regression test for missing/invalid
  tokens.

---

Notes on classification applied during this audit:
- Events that require a live network, a live device, or a shipping decision
  are recorded as **unresolved candidates**, not vulnerabilities.
- The schema, RLS layer, SECURE DEFINER RPC, idempotency, and token gates
  are all verified against source plus local Postgres emulation.
