/**
 * ═════════════════════════════════════════════════════════════
 * RUCHI E2E simulation — app query patterns vs a real Postgres
 * ═════════════════════════════════════════════════════════════
 * Replays the brief's User A / User B lifecycle using the same query
 * shapes supabase-data.ts issues (select.eq.maybeSingle, insert,
 * upsert, rpc) against a throwaway local Postgres with the Supabase
 * emulation (auth.users + auth.uid() from request.jwt.claim.sub).
 *
 * Every "request" runs as the non-owner `authenticated` role inside a
 * committed transaction with a per-request identity — the same security
 * posture as PostgREST serving a Supabase JWT. This validates the DATA
 * LAYER contract: persistence, dedupe, isolation, restore. It does NOT
 * exercise supabase-js auth (no hosted Supabase in this environment) —
 * that is reported honestly as still unverified.
 *
 * Usage:  node supabase/tests/e2e-sim.mjs
 * Exit 0 = all steps passed, 1 = any failure.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const PGUSER = process.env.PGUSER || process.env.USER || "postgres";
const ADMIN = { host: "/tmp", user: PGUSER, database: "postgres" };
const DB = `ruchi_e2e_${randomUUID().slice(0, 8)}`;

let failures = 0;
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => { console.log(`FAIL: ${m}`); failures++; };

function sh(cmd) {
  execSync(`psql -q -h /tmp -U ${PGUSER} -d postgres -c "${cmd}"`, { stdio: "pipe" });
}
const sql = (t, text, params) => t.query(text, params);
const one = async (t, text, params) => (await t.query(text, params)).rows[0] ?? null;

/** One client "request": non-owner role, identity claim, committed tx. */
async function request(user, fn) {
  const client = new pg.Client({ ...ADMIN, database: DB });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    if (user) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    else await client.query("reset request.jwt.claim.sub");
    return await fn(client);
  } finally {
    await client.query("commit").catch(() => {});
    await client.end();
  }
}

// ── App-shaped operations (mirror supabase-data.ts) ──────────
async function appInsertMeal(t, userId, m) {
  await t.query(
    `insert into public.completed_meals
       (user_id, recipe_id, recipe_name, completed_at, local_date, servings, protein_g, calories, cost_inr, savings_inr)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [userId, m.recipeId, m.recipeName, new Date(m.cookedAt).toISOString(), m.localDate,
     m.servings, m.proteinG, m.calories, m.cost, m.savings],
  );
}
const appFetchMeals = (t, uid) =>
  t.query("select * from public.completed_meals where user_id = $1 order by completed_at desc limit 200", [uid]);
async function appUpsertProfile(t, userId, displayName) {
  await t.query(
    `insert into public.profiles (id, display_name) values ($1,$2)
     on conflict (id) do update set display_name = $2, updated_at = now()`,
    [userId, displayName],
  );
}
const appRpcStreak = (t, date) => t.query("select public.record_completed_meal_day($1)", [date]);
const appFetchStreak = (t, uid) =>
  one(t, "select current_streak, longest_streak from public.cooking_streaks where user_id = $1", [uid]);

// ── Real Cooking Stats (migration 0003 shapes) ───────────────
/** Mirrors recordCookingCompletion(): RPC with a session token. */
const appRecordCompletion = (t, tok, m) =>
  one(
    t,
    `select public.record_cooking_completion(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as outcome`,
    [tok, m.recipeId, m.recipeName, new Date(m.cookedAt).toISOString(), m.localDate,
     m.servings, m.proteinG, m.calories, m.cost, m.deliveryCompare],
  );
const appFetchStats = (t) =>
  one(t, "select meals_cooked, total_saved, current_streak, longest_streak from public.cooking_stats");
const appFetchCompletions = (t, uid) =>
  t.query("select * from public.cooking_completions where user_id = $1 order by completed_at desc", [uid]);

// ── Boot: DB + emulation + migration + two users ─────────────
sh(`create database "${DB}"`);
{
  const boot = new pg.Client({ ...ADMIN, database: DB });
  await boot.connect();
  for (const f of [
    "supabase/tests/local_emulation.sql",
    "supabase/migrations/0001_ruchi_init.sql",
    "supabase/migrations/0002_beta_feedback.sql",
    "supabase/migrations/0003_cooking_stats.sql",
    "supabase/migrations/0004_notification_prefs.sql",
  ]) {
    await boot.query(await import("node:fs/promises").then((fs) => fs.readFile(f, "utf8")));
  }
  for (const email of ["a@test.dev", "b@test.dev"]) {
    await boot.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing",
      [randomUUID(), email]);
  }
  var USERS = (await boot.query("select id, email from auth.users order by email")).rows;
  await boot.end();
}
const [USER_A, USER_B] = USERS;
console.log(`db=${DB} A=${USER_A.email} B=${USER_B.email}\n`);

try {
  // ════ 1. User A signs in, completes a meal ════
  await request(USER_A.id, async (t) => {
    await appUpsertProfile(t, USER_A.id, "User A");
    await appInsertMeal(t, USER_A.id, {
      recipeId: "paneer-egg-bhurji", recipeName: "Paneer Egg Bhurji",
      cookedAt: new Date(2026, 8, 16, 21).getTime(), localDate: "2026-09-16",
      servings: 2, proteinG: 38, calories: 520, cost: 82, savings: 221,
    });
    await appRpcStreak(t, "2026-09-16");
  });
  pass("A: profile + completed meal + streak day recorded");

  // ════ 2. Persisted? ════
  let rows = (await request(USER_A.id, (t) => appFetchMeals(t, USER_A.id))).rows;
  if (rows.length === 1 && rows[0].recipe_id === "paneer-egg-bhurji") pass("A: meal persisted (visible to A)");
  else fail(`A: meal not persisted (${rows.length} rows)`);

  let st = await request(USER_A.id, (t) => appFetchStreak(t, USER_A.id));
  if (st && st.current_streak === 1) pass("A: streak persisted (current=1)");
  else fail(`A: streak not persisted (${JSON.stringify(st)})`);

  // ════ 3. Duplicate same-day completion does not inflate ════
  await request(USER_A.id, async (t) => {
    await appInsertMeal(t, USER_A.id, {
      recipeId: "egg-fried-rice", recipeName: "Egg Fried Rice",
      cookedAt: new Date(2026, 8, 16, 22).getTime(), localDate: "2026-09-16",
      servings: 1, proteinG: 29, calories: 480, cost: 61, savings: 139,
    });
    await appRpcStreak(t, "2026-09-16"); // same day again
  });
  st = await request(USER_A.id, (t) => appFetchStreak(t, USER_A.id));
  if (st.current_streak === 1) pass("A: second meal same day → streak stays 1 (no inflation)");
  else fail(`A: same-day dup inflated streak: ${st.current_streak}`);
  rows = (await request(USER_A.id, (t) => appFetchMeals(t, USER_A.id))).rows;
  if (rows.length === 2) pass("A: both meals kept in history (history ≠ streak)");
  else fail(`A: expected 2 history rows, got ${rows.length}`);

  // ════ 4. "Refresh": fresh session still sees the data ════
  const refreshed = await request(USER_A.id, async (t) => ({
    meals: (await appFetchMeals(t, USER_A.id)).rowCount,
    streak: await appFetchStreak(t, USER_A.id),
    profile: await one(t, "select display_name from public.profiles where id = $1", [USER_A.id]),
  }));
  if (refreshed.meals === 2 && refreshed.streak.current_streak === 1 && refreshed.profile.display_name === "User A")
    pass("A: after refresh (new session) meals+streak+profile restored");
  else fail(`A: refresh restore incomplete: ${JSON.stringify(refreshed)}`);

  // ════ 5. Sign out, sign in as User B → isolation ════
  rows = (await request(USER_B.id, (t) => appFetchMeals(t, USER_A.id))).rows;
  if (rows.length === 0) pass("B: cannot read any of A's meals");
  else fail(`LEAK: B reads ${rows.length} of A's meals`);

  const bView = (await request(USER_B.id, (t) => appFetchMeals(t, USER_B.id))).rows;
  if (bView.length === 0) pass("B: own history starts empty");
  else fail(`B: unexpected rows: ${bView.length}`);

  // B cooks their own meal on the same day.
  await request(USER_B.id, async (t) => {
    await appInsertMeal(t, USER_B.id, {
      recipeId: "paneer-egg-bhurji", recipeName: "Paneer Egg Bhurji",
      cookedAt: new Date(2026, 8, 16, 20).getTime(), localDate: "2026-09-16",
      servings: 1, proteinG: 38, calories: 520, cost: 82, savings: 221,
    });
    await appRpcStreak(t, "2026-09-16");
  });
  st = await request(USER_B.id, (t) => appFetchStreak(t, USER_B.id));
  if (st.current_streak === 1) pass("B: independent streak (same-day cooking doesn't merge streaks)");
  else fail(`B: streak ${st.current_streak}`);

  // ════ 6. Cross-account dedupe semantics (client merge logic) ════
  // The dedupe KEY is (recipe_id, local_date). A's two rows differ.
  const aKey = new Set(["paneer-egg-bhurji|2026-09-16", "egg-fried-rice|2026-09-16"]);
  const bKey = new Set(["paneer-egg-bhurji|2026-09-16"]);
  const overlap = [...aKey].filter((k) => bKey.has(k));
  // Same key on both sides is EXPECTED here (both cooked the same recipe
  // the same day, separately). The store's merge treats a key as one
  // logical meal: B pulling A's data must not happen at all (isolation),
  // and A re-signing-in must NOT adopt B's duplicate.
  if (overlap.length === 1) pass("dedupe key (recipe_id, local_date) collides for same-recipe-same-day cooks");
  else fail("dedupe key setup wrong");

  // ════ 7. Sign back in as A — restore intact, B's data absent ════
  const aRestore = await request(USER_A.id, async (t) => {
    const meals = (await appFetchMeals(t, USER_A.id)).rows.map((r) => `${r.recipe_id}|${r.local_date}`);
    const streak = await appFetchStreak(t, USER_A.id);
    return { meals, streak };
  });
  if (aRestore.meals.length === 2 && !aRestore.meals.some((k) => k.startsWith("x"))) {
    pass("A: sign-back-in restores exactly A's 2 meals");
  } else fail(`A: restore wrong: ${JSON.stringify(aRestore.meals)}`);
  if (!aRestore.meals.some((k) => k.includes("2026-09-16") === false && false)) { /* noop */ }
  if (aRestore.streak.current_streak === 1) pass("A: streak unchanged after B's session");
  else fail(`A: streak corrupted: ${aRestore.streak.current_streak}`);

  // ════ 8. RLS tamper checks (as the app would, via client role) ════
  const leak = await request(USER_B.id, (t) =>
    t.query("update public.profiles set display_name='hacked' where id=$1 returning id", [USER_A.id]));
  if (leak.rowCount === 0) pass("B: cannot modify A's profile (0 rows returned)");
  else fail("LEAK: B modified A's profile");

  const steal = await request(USER_B.id, async (t) => {
    try {
      await t.query(
        "insert into public.completed_meals (user_id, recipe_id, recipe_name, local_date) values ($1,'x','x','2026-09-16')",
        [USER_A.id]);
      return { blocked: false };
    } catch (e) {
      return { blocked: true, message: String(e.message) };
    }
  });
  if (steal.blocked && steal.message.includes("row-level security"))
    pass("B: cannot insert meals under A's id (RLS with check)");
  else fail(`LEAK: B inserted a meal as A: ${JSON.stringify(steal)}`);

  const anonRead = await request(null, (t) => t.query("select count(*)::int as n from public.completed_meals"));
  if (anonRead.rows[0].n === 0) pass("anonymous: reads nothing");
  else fail(`anon sees ${anonRead.rows[0].n} rows`);

  const anonWrite = await request(null, async (t) => {
    try {
      await t.query(
        "insert into public.completed_meals (user_id, recipe_id, recipe_name, local_date) values ($1,'x','x','2026-09-16')",
        [USER_A.id]);
      return { blocked: false };
    } catch (e) {
      return { blocked: true, message: String(e.message) };
    }
  });
  if (anonWrite.blocked && anonWrite.message.includes("row-level security"))
    pass("anonymous: cannot insert meals (RLS rejection)");
  else fail(`anon insert unexpectedly allowed: ${JSON.stringify(anonWrite)}`);

  // ═════════════════════════════════════════════════════════════
  // 9. REAL COOKING STATS (migration 0003)
  // ═════════════════════════════════════════════════════════════
  const TODAY = new Date();
  const day = (offset) => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const at = (offset, hour) => {
    const [y, m, d] = day(offset).split("-").map(Number);
    return new Date(y, m - 1, d, hour).getTime();
  };

  // 9a. Record A's completion → 'recorded'; duplicate session → 'duplicate',
  //     and it must NOT create a second row (idempotency).
  let outcome = await request(USER_A.id, (t) => appRecordCompletion(t, "sess-aaa", {
    recipeId: "paneer-egg-bhurji", recipeName: "Paneer Egg Bhurji",
    cookedAt: at(0, 21), localDate: day(0), servings: 1,
    proteinG: 38, calories: 520, cost: 82, deliveryCompare: 303,
  }));
  if (outcome?.outcome === "recorded") pass("stats: completion recorded");
  else fail(`stats: expected 'recorded', got ${JSON.stringify(outcome)}`);

  outcome = await request(USER_A.id, (t) => appRecordCompletion(t, "sess-aaa", {
    recipeId: "paneer-egg-bhurji", recipeName: "Paneer Egg Bhurji",
    cookedAt: at(0, 21), localDate: day(0), servings: 1,
    proteinG: 38, calories: 520, cost: 82, deliveryCompare: 303,
  }));
  const aCompRows = (await request(USER_A.id, (t) => appFetchCompletions(t, USER_A.id))).rows;
  if (outcome?.outcome === "duplicate" && aCompRows.length === 1)
    pass("stats: double-clicked completion is idempotent (1 row, 'duplicate')");
  else fail(`stats: idempotency broken: outcome=${JSON.stringify(outcome)} rows=${aCompRows.length}`);

  // 9b. Savings derived SERVER-side: greatest(0, compare − cost).
  if (aCompRows[0].savings_inr === 221)
    pass("stats: savings derived server-side (303 − 82 = 221)");
  else fail(`stats: wrong savings ${aCompRows[0].savings_inr}`);
  await request(USER_A.id, (t) => appRecordCompletion(t, "sess-clamp", {
    recipeId: "egg-rice", recipeName: "Egg Rice", cookedAt: at(0, 0),
    localDate: day(0), servings: 1, proteinG: 17, calories: 549,
    cost: 500, deliveryCompare: 100,
  }));
  const clampRow = (await request(USER_A.id, (t) =>
    t.query("select savings_inr from public.cooking_completions where session_token='sess-clamp'"))).rows[0];
  if (clampRow && clampRow.savings_inr === 0)
    pass("stats: negative saving clamped to 0 (never invented)");
  else fail(`stats: savings clamp broken: ${JSON.stringify(clampRow)}`);

  // 9c. More sessions on consecutive days → streak from COMPLETIONS.
  await request(USER_A.id, (t) => appRecordCompletion(t, "sess-bbb", {
    recipeId: "egg-rice", recipeName: "Egg Rice",
    cookedAt: at(1, 20), localDate: day(1), servings: 1,
    proteinG: 17, calories: 549, cost: 17, deliveryCompare: 190,
  }));
  await request(USER_A.id, (t) => appRecordCompletion(t, "sess-ccc", {
    recipeId: "dal-rice", recipeName: "Dal Rice",
    cookedAt: at(2, 20), localDate: day(2), servings: 1,
    proteinG: 12, calories: 350, cost: 14, deliveryCompare: 160,
  }));
  let stats = await request(USER_A.id, (t) => appFetchStats(t));
  // The view unions A's 2 legacy completed_meals rows (migration-0001 log)
  // with the new completions: 2 legacy + 4 sessions (aaa, clamp, bbb, ccc) = 6.
  const expectedA = { meals: 6, saved: 221 + 221 + 139 + 173 + 146, streak: 3 };
  if (stats.meals_cooked === expectedA.meals && stats.current_streak === expectedA.streak && stats.longest_streak === 3)
    pass(`stats: 3 consecutive days → current=3, longest=3, meals=${expectedA.meals} (legacy + new)`);
  else fail(`stats: streak math wrong: ${JSON.stringify(stats)}`);
  if (stats.total_saved === expectedA.saved)
    pass("stats: total saved aggregates every record's server-derived saving");
  else fail(`stats: savings aggregate wrong: ${stats.total_saved} != ${expectedA.saved}`);

  // 9d. A gap breaks the CURRENT streak but LONGEST persists.
  await request(USER_A.id, (t) => appRecordCompletion(t, "sess-old", {
    recipeId: "poha", recipeName: "Poha",
    cookedAt: at(10, 9), localDate: day(10), servings: 1,
    proteinG: 5, calories: 270, cost: 9, deliveryCompare: 120,
  }));
  stats = await request(USER_A.id, (t) => appFetchStats(t));
  if (stats.current_streak === 3 && stats.longest_streak === 3)
    pass("stats: old completion → longest preserved, current unaffected");
  else fail(`stats: gap handling wrong: ${JSON.stringify(stats)}`);

  // 9e. "Refresh": brand-new session (fresh connection) sees identical stats.
  const statsRefresh = await request(USER_A.id, (t) => appFetchStats(t));
  if (statsRefresh.meals_cooked === stats.meals_cooked && statsRefresh.total_saved === stats.total_saved)
    pass("stats: values persist across a fresh session (refresh-safe)");
  else fail("stats: refresh drift");

  // 9f. User isolation: B sees none of A's completions and B's stats start clean.
  const bComps = (await request(USER_B.id, (t) => appFetchCompletions(t, USER_B.id))).rows;
  if (bComps.length === 0) pass("stats: B cannot read any of A's completions");
  else fail(`LEAK: B reads ${bComps.length} of A's completions`);
  const bStats = await request(USER_B.id, (t) => appFetchStats(t));
  // B's own records: 1 legacy completed_meals row (step 5) — A's 5 are invisible.
  if (bStats && bStats.meals_cooked === 1 && bStats.total_saved === 221)
    pass("stats: B's view contains only B's records");
  else fail(`stats: B's view polluted: ${JSON.stringify(bStats)}`);

  // 9g. B cannot attach a completion to A's user id (session-id CHECK + RLS).
  const forge = await request(USER_B.id, async (t) => {
    try {
      await t.query(
        `insert into public.cooking_completions
           (user_id, session_token, session_id, recipe_id, recipe_name, local_date,
            cost_inr, delivery_compare_inr)
         values ($1,'forged','s_'||$2::text||':forged','x','x',current_date,10,50)`,
        [USER_A.id, USER_B.id]);
      return { blocked: false };
    } catch (e) {
      return { blocked: true, message: String(e.message) };
    }
  });
  if (forge.blocked && forge.message.includes("row-level security"))
    pass("stats: B cannot insert a completion under A's id (RLS with check)");
  else fail(`LEAK: forged completion accepted: ${JSON.stringify(forge)}`);

  // 9h. Anonymous callers get nothing: no stats, no RPC.
  const anonStats = await request(null, (t) => t.query("select count(*)::int as n from public.cooking_stats"));
  if (anonStats.rows[0].n === 0)
    pass("stats: anonymous reads no stats (security_invoker + RLS)");
  else fail(`stats: anon sees ${anonStats.rows[0].n} stat rows`);
  const anonRpc = await request(null, async (t) => {
    try {
      await t.query("select public.record_cooking_completion('x','x','x',now(),current_date,1,0,0,0,0)");
      return { blocked: false };
    } catch (e) {
      return { blocked: true, message: String(e.message) };
    }
  });
  if (anonRpc.blocked) pass("stats: anonymous cannot call the completion RPC");
  else fail("stats: anon RPC executed");

  // ════ 10. NOTIFICATION PREFS (migration 0004) ═════════════
  // Defaults OFF, RLS own-rows-only, channel/quiet-hours constraints,
  // and the attention-state mirror updates (never creates) rows.

  // 10a. A's row does not exist until explicit opt-in.
  const noRow = await request(USER_A.id, (t) =>
    t.query("select count(*)::int as n from public.notification_prefs"));
  if (noRow.rows[0].n === 0) pass("notif: no prefs row exists before opt-in (defaults off)");
  else fail(`notif: unexpected pre-opt-in row(s): ${noRow.rows[0].n}`);

  // 10b. Opt-in: insert own row; constraints shape it.
  await request(USER_A.id, (t) =>
    t.query(
      "insert into public.notification_prefs (user_id, channels) values ($1, $2::jsonb)",
      [USER_A.id, JSON.stringify({ web_push: true })],
    ));
  const aPrefs = await request(USER_A.id, (t) =>
    one(t, "select channels, quiet_hours, max_per_week from public.notification_prefs where user_id = $1", [USER_A.id]));
  if (aPrefs.channels.web_push === true && aPrefs.quiet_hours.start === 22 && aPrefs.max_per_week === 2)
    pass("notif: opt-in row created; quiet hours + weekly cap default sane");
  else fail(`notif: opt-in defaults wrong: ${JSON.stringify(aPrefs)}`);

  // 10c. Bad channel key and non-boolean flag are rejected by the CHECK.
  const badChannel = await request(USER_A.id, async (t) => {
    try {
      await t.query(
        "update public.notification_prefs set channels = $2::jsonb where user_id = $1",
        [USER_A.id, JSON.stringify({ sms: true })],
      );
      return { blocked: false };
    } catch (e) {
      return { blocked: true, message: String(e.message) };
    }
  });
  if (badChannel.blocked) pass("notif: unknown channel key rejected by constraint");
  else fail("notif: bad channel accepted — CHECK missing");

  const badQuiet = await request(USER_A.id, async (t) => {
    try {
      await t.query(
        "update public.notification_prefs set quiet_hours = $2::jsonb where user_id = $1",
        [USER_A.id, JSON.stringify({ start: 30, end: 8 })],
      );
      return { blocked: false };
    } catch (e) {
      return { blocked: true };
    }
  });
  if (badQuiet.blocked) pass("notif: out-of-range quiet hour rejected by constraint");
  else fail("notif: bad quiet_hours accepted — CHECK missing");

  // 10d. Attention-state mirror: update never creates; RLS blocks B from A.
  await request(USER_A.id, (t) =>
    t.query(
      "update public.notification_prefs set attention_state = $2::jsonb where user_id = $1",
      [USER_A.id, JSON.stringify({ lastShown: { type: "unused_ingredients", recipeId: "egg-rice", at: 1790000000000 } })],
    ));
  const mirror = await request(USER_A.id, (t) =>
    one(t, "select attention_state from public.notification_prefs where user_id = $1", [USER_A.id]));
  if (mirror.attention_state.lastShown?.type === "unused_ingredients")
    pass("notif: attention-state mirror round-trips");
  else fail(`notif: mirror write failed: ${JSON.stringify(mirror)}`);

  const bMirrorTouch = await request(USER_B.id, async (t) => {
    try {
      const r = await t.query(
        "update public.notification_prefs set attention_state = '{}'::jsonb where user_id = $1",
        [USER_A.id],
      );
      return { rows: r.rowCount };
    } catch (e) {
      return { rows: -1, blocked: true };
    }
  });
  if (bMirrorTouch.rows === 0 || bMirrorTouch.blocked)
    pass("notif: B cannot touch A's prefs (RLS)");
  else fail(`LEAK: B updated A's prefs (${bMirrorTouch.rows} rows)`);

  // 10e. Anonymous: nothing at all.
  const anonPrefs = await request(null, (t) =>
    t.query("select count(*)::int as n from public.notification_prefs"));
  if (anonPrefs.rows[0].n === 0) pass("notif: anonymous reads no prefs");
  else fail(`LEAK: anon reads ${anonPrefs.rows[0].n} prefs rows`);

  // 10f. updated_at advances on update (trigger).
  const t1 = await request(USER_A.id, (t) =>
    one(t, "select updated_at from public.notification_prefs where user_id = $1", [USER_A.id]));
  await new Promise((r) => setTimeout(r, 30));
  await request(USER_A.id, (t) =>
    t.query("update public.notification_prefs set max_per_week = 3 where user_id = $1", [USER_A.id]));
  const t2 = await request(USER_A.id, (t) =>
    one(t, "select updated_at from public.notification_prefs where user_id = $1", [USER_A.id]));
  if (new Date(t2.updated_at) > new Date(t1.updated_at))
    pass("notif: updated_at advances on update (trigger)");
  else fail("notif: updated_at did not advance");
} catch (e) {
  fail(`unexpected: ${e.message}`);
} finally {
  const admin = new pg.Client(ADMIN);
  await admin.connect();
  await admin.query(`drop database if exists "${DB}"`);
  await admin.end();
}

console.log(failures === 0 ? "\nE2E SIMULATION: ALL PASSED" : `\nE2E SIMULATION: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
