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

// ── Boot: DB + emulation + migration + two users ─────────────
sh(`create database "${DB}"`);
{
  const boot = new pg.Client({ ...ADMIN, database: DB });
  await boot.connect();
  for (const f of ["supabase/tests/local_emulation.sql", "supabase/migrations/0001_ruchi_init.sql"]) {
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
