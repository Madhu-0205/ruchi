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
- "Need help?" answers use the CURRENT step and recipe (Puter AI; if AI is
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

## Offline / failure testing

- Airplane mode: browsing, text ingredients, recommendations, Cooking Mode
  (with help-fallback) all still work; cloud sync resumes when back online
- Supabase down: app keeps working locally, "Back up now" shows a sync error
  instead of failing silently
- Gibberish search ("zzzqqq") → empty state with suggestions, never a blank
  screen

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
- Photo recognition needs Puter's browser AI authorization on first use;
  declining it never blocks the app.

## What is intentionally not included

Social feeds · grocery ordering · subscriptions · achievements · a generic
AI chatbot · public profiles. If you miss one of these, that's by design —
tell us what you'd actually use instead.
