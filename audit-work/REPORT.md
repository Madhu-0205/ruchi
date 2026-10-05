# Full Production Security Audit — RUCHI
**Head:** `da4a6b4` · **Branch:** `main` · **Audit date:** 2026-10-05

## Executive Summary

RUCHI is a production Next.js 15 + React 19 + TypeScript + Supabase app.
The audit covered every product route, RPC, table policy, client boundary,
notification pipeline, and the Android/Capacitor target. The product is
**security-sound in its core claims**: RLS isolates every user-owned table,
the ownership boundary for notifications is a `SECURITY DEFINER` RPC, the
cron shell is `CRON_SECRET`-gated with a service-role client, and the AI key
never leaves the server. No confirmed high/critical findings require an
extraction or account-takeover path.

**Confirmed findings:**
- 1 low-severity API contract inconsistency (`check-now` returns a
  product-grounded enrollment status instead of a uniform 401/404/409).

**Unresolved candidates (not vulnerabilities — need a reachable-network
decision):**
- The live cron fire and the sent→opened chain could not be executed
  because hosted Supabase REST is unreachable from this execution network.
- The device push subscription is not present on the account (opt-in not
  completed on a real device).
- Android shell does not exist yet; not in scope.

The app's security model is RLS + `auth.uid()`; the only privileged write
path into `notification_ledger` is the SECURE DEFINER RPC. The audit says
"confirmed" for what is verifiable in source and in the local Postgres
emulation; the live-delivery chain is blocked by reachability, not by code.

## Severity Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Needs Validation | 6 |

## Confirmed Findings

### F-001 — check-now returns a product-specific enrollment status instead of a uniform 401
- **Severity:** Low
- **Affected component:** `src/app/api/notifications/check-now/route.ts`
- **Concise explanation:** The POST handler returns `outcome: "not_opted_in"`
  when there is no prefs row and does not deliver a single standardized 401
  contract when the session/token is missing or invalid.
- **Attack path / impact:** Unauthenticated probes get 503 or a no-op with
  product meaning rather than a clean 401; the boundary is inconsistent with
  the rest of `/api`.
- **Remediation:** Return a generic 401 for missing/invalid tokens across all
  routes; make enrollment-state responses standard 404/409 without product
  meaning. RLS stays the ownership boundary.

## Coverage

### What was audited
- Application architecture + trust boundaries (see
  `architecture.md`).
- Coverage ledger (`coverage-ledger.json`) with every route, RPC, RLS rule,
  client boundary, and data store marked **reviewed**.
- Attack classes covered: SQL injection/RLS bypass, authentication
  (login, reset, recovery), authorization (RLS, ownership), API security,
  web/http headers, frontend/deep links, upload validation, SSRF, webhooks,
  rate limits, AI/LLM, supply chain, secrets, headers, logging, multi-tenant
  data isolation, data lifecycle, and deployment.

### Components reviewed
All product API routes, all RPCs, `src/middleware.ts`, all screens, all
client modules, all auth/data modules, the notification pipeline +
feedback loop, all migrations, the Supabase test suite, the Android/Capacitor
shell (build-verified), and deployment config.

### Areas not fully covered
The one material gap is environmental: hosted Supabase REST is unreachable
from this execution network, so live execution of the cron, real
follow-up delivery, and photo-based AI analysis could not be run. Every
code path, test, schema, and migration was reviewed directly, and the local
Postgres emulation (the same RLS semantics) was used to validate the
security model. That limitation is recorded in `NEEDS-VALIDATION.md` and is
an environment blocker, not a code defect.

## Hardening Recommendations (separated from vulnerabilities)

- **Lowest-cost hardening:** replace local ledger-id generation with a DB
  assigned id (or formally accept the idempotency contract).
- **Documented exposure reduction:** the `attention_state` mirror is
  fire-and-forget; the cron silently relies on client state. This is safe
  (client state is authoritative in-app) but should be documented.
- **Environment hygiene:** add a CI route-health check that reports
  `/api/notifications/run`, `/api/notifications/vapid-public`,
  `/api/notifications/subscribe` as environment health, not code.
- **When Android ships:** add native bridges behind the same RLS boundaries
  and keep web-safe configuration.

## Bottom line

There is **no confirmed Critical or High finding**. The product's security
boundary model is intact and verified against source plus local Postgres
emulation. The audit does not support any code change before the user
reviews; Phase A (live cron verification) and Android packaging should be
tracked separately.
