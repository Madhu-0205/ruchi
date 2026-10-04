# RUCHI Beta Testing

Practical guide for the controlled beta. No marketing — just what to test,
what to expect, and what to report.

## What to test

RUCHI's promise: **"I have ingredients. Tell me what I can actually cook."**
Everything below exists to check that promise against real kitchens, real
phones, and real cooking.

## Main user journey

1. Open the app. You should understand what it does within a few seconds —
   no sign-up wall. Anonymous use is fully supported.
2. Add 3–5 ingredients you actually have (Kitchen tab → type, or use the
   suggestion chips). Telugu/Hindi names work.
3. Home shows 4 picks with reasons ("Uses 2 of 4 ingredients you already
   have", protein, time, price).
4. Tap a card → check quantities, missing items, substitutions.
5. Change servings (1 → 4+). Quantities should stay sensible
   (½ tbsp, not 0.63 tbsp).
6. "Start cooking" → one step at a time: quantity, heat, timer, what to look
   for, safety note. Try the timer, pause/resume, "Need help?".
7. Finish the last step with "I'm done cooking 🎉" → completion screen with
   protein, estimated cost, savings, streak.
8. If signed in: refresh the page. Meals, streak and preferences should
   survive. Sign out → everything local stays usable, no account forced.

## Camera testing

The photo flow (Home → "Show me what you've got") uses the browser camera
or gallery. Test on your phone:

**Android + iOS, both:**
- [ ] Camera permission: allow → capture works
- [ ] Camera permission: deny → gallery/upload fallback offered
- [ ] Permission restored later (from browser settings) → capture works
- [ ] Photo capture (rear camera) with 3+ ingredients on a counter
- [ ] Photo selection from gallery
- [ ] Poor lighting / cluttered counter → honest results or "couldn't read",
      never invented ingredients
- [ ] Very large photo (modern phone camera, 10+ MB) → processes or rejects
      gracefully
- [ ] AI failure (airplane mode right after capture) → clear message +
      "type what I have" path, no fake results
- [ ] Retry after failure works

**Notes:** unsupported files (PDF, GIF) must be rejected politely. RUCHI
never stores your photo.

## Cooking Mode testing

- Every control: Exit, Next, Back, Done, Pause/Resume, timer Start, "Need help?"
- Timer must never block navigation; leaving Cooking Mode mid-recipe is safe
- "Need help?" answers use the CURRENT step and recipe (curated help; if AI is
  unavailable a built-in answer appears — this is normal, not an error)
- One-handed use while standing in a kitchen: buttons reachable, text
  readable at arm's length

## Authentication testing

- Sign up → confirmation email → confirm → sign in
- Wrong password → clear message, no crash
- Sign out → anonymous mode fully usable; your data reappears when you sign
  back in on the same device
- Refresh while signed in → still signed in
- Two accounts on one device → each sees only its own meals/streak

### Password reset (new)

1. Signed out → Profile → "Forgot password?" → enter email → "Send reset link"
2. The app says a link is on its way **if** that address has an account —
   it never reveals whether the address is registered
3. Open the email link → RUCHI opens with a "Set a new password" card
4. Set a new password → "Password updated" → sign in with the new password
5. Reuse the old password → honest "pick a different password" message
6. "Back to sign in" from the reset card → app stays fully usable

Prerequisite (project config, one-time): the reset redirect URL (e.g.
`https://YOUR-DOMAIN/`) must be allow-listed under Supabase → Auth →
URL Configuration → Redirect URLs, or Supabase will reject the email
request. Set `NEXT_PUBLIC_PASSWORD_RESET_REDIRECT` in `.env.local` for
non-root deployments (e.g. preview URLs).

NOTE: "link expired / already used" appears as a generic submit error if
the link is tapped twice — the fix is simply requesting a fresh link.

## Offline / failure testing

- Airplane mode: browsing, text ingredients, recommendations, Cooking Mode
  (with help-fallback) all still work; cloud sync resumes when back online
- Supabase down: app keeps working locally, "Back up now" shows a sync error
  instead of failing silently
- Gibberish search ("zzzqqq") → empty state with suggestions, never a blank
  screen

## Notifications 2.0 (opt-in, live)

Push is live in production. RUCHI checks in at most once a day (the server
check runs around 6 pm IST) and only sends when something real happened in
your app — never marketing, no emails, browser push only.

**Opt in (one-time, per device):**

1. iPhone: open the app in Safari → Share → **Add to Home Screen** first
   (iOS only delivers web push to an installed app; iOS 16.4+). Android:
   any browser works.
2. Sign in. Push and the open-tracking ledger are tied to your account.
3. Profile → Notifications → turn on **"Dinner nudges"** → **Allow** when
   the browser asks. If it says blocked, re-enable this site's
   notifications in browser settings.

**What can arrive** — each type has its own switch under "What RUCHI may
nudge you about":

- Finish a dish you paused mid-cook (points back at the exact step)
- A meal idea built from the ingredients you actually scanned or added
- A quick follow-up right after you scanned or viewed a dish
- "Round two" on a dish you finished a day or more ago
- Occasionally, one Discover category worth a look (once a week)

**Guardrails you should be able to feel:**

- Off by default; master toggle off = silence immediately
- At most 1 push/day and 2/week, and never between 10 pm and 8 am IST
- The same reminder for the same dish never sends twice the same day
- Tapping a push lands on the exact screen the message promised
- A push whose context has expired (e.g. you already resumed) is dropped
  silently — a late reminder never nags about something that's over

### Notification checklist

- [ ] Opt-in: permission prompt → Allow → toggle stays on after refresh
- [ ] iPhone: added to Home Screen BEFORE opting in (otherwise no push)
- [ ] Pause a dish in the morning (advance 1+ step, exit Cooking Mode) →
      the finish-it nudge can arrive at the evening check; tapping it
      opens Cooking Mode at your saved step
- [ ] **Check now** (Profile → Notifications): runs the same check on
      demand instead of waiting for 6 pm — pressing it twice cannot
      send a second push
- [ ] Scan ingredients → confirm → any idea that arrives names a dish
      using what you actually have
- [ ] Switch OFF one nudge type (e.g. "Cook again") → that type never
      arrives; the others still can
- [ ] Master toggle off → nothing arrives; back on → works again
- [ ] Nothing arrives between 10 pm and 8 am
- [ ] Never more than one push in a day

Report wrong timing, an irrelevant idea, a wrong landing screen, or
anything that feels like spam — those are bugs.

## What to report

Use **Profile → Beta feedback** (signed in) — pick a topic and describe what
happened. Reports go to the project's own Supabase database (row-level
security, no personal data collected beyond your account id). If you can't
sign in, message the developer directly.

Report especially:
- a recipe that didn't match what you actually had
- an ingredient the app didn't recognize
- a cooking step that was wrong, unclear, or unsafe-feeling
- any screen where you didn't know what to do next
- anything that felt slow

## Known limitations

- Physical-device camera and small-screen (360–430 px) testing is still in
  progress — that's what this beta is partly for.
- Prices and nutrition are **estimates** from typical metro-India
  ingredient costs, not live market data.
- Email confirmation is required before first sign-in (Supabase default).
- Photo recognition requires the server's GEMINI_API_KEY to be configured;
  declining it never blocks the app.

## What is intentionally not included

Social feeds · grocery ordering · subscriptions · achievements · a generic
AI chatbot · public profiles. If you miss one of these, that's by design —
tell us what you'd actually use instead.
