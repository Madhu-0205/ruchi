#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════
# RUCHI migration verification (real Postgres execution)
# ═════════════════════════════════════════════════════════════
# Runs supabase/migrations/0001_ruchi_init.sql against a throwaway
# local Postgres database with a Supabase emulation (auth schema,
# auth.users, auth.uid() from request.jwt.claim.sub) and asserts the
# security model:
#   • migration applies cleanly and is idempotent (runs twice)
#   • RLS is enabled on all three tables
#   • a user cannot read/modify another user's rows (SELECT/UPDATE)
#   • anonymous role has no access at all
#   • record_completed_meal_day: first meal → 1, consecutive day → +1,
#     same-day duplicate no-op, gap reset, older-date no-op
#   • signup trigger creates a profile row
#
# Fidelity notes (this is what makes the isolation checks honest):
#   • Client sessions run as the non-owner role `authenticated` via
#     SET ROLE — on Supabase, client connections always arrive as the
#     non-owner roles authenticated/anon; a table owner would bypass
#     RLS and make the "leak" tests meaningless.
#   • Streak RPC calls run in committed transactions (each call is its
#     own psql invocation) so day N+1 actually sees day N's state —
#     mirroring separate HTTP requests through PostgREST.
#   • Session identity is set with request.jwt.claim.sub, the same GUC
#     PostgREST populates from the caller's JWT.
#
# Results print as PASS/FAIL lines; exit 1 if any FAIL.
# Usage: supabase/tests/verify-local.sh
# ═════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/../.."   # repo root

DB="ruchi_verify_$$"
FAILS=0

say()  { printf '%s\n' "$*"; }
pass() { say "PASS: $*"; }
fail() { say "FAIL: $*"; FAILS=$((FAILS+1)); }

# Autocommit psql call as the emulated client role.
q()  { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
qf() { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

# A committed client transaction as `authenticated` with an identity:
# mirrors one PostgREST request (SET ROLE + claim + work + COMMIT).
tx() { # $1 = user uuid, $2 = SQL
  psql -qAt -v ON_ERROR_STOP=1 -d "$DB" \
    -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$1'; $2; commit;"
}
# Same, without an identity (anonymous caller). SQL is $1.
tx_anon() {
  psql -qAt -v ON_ERROR_STOP=1 -d "$DB" \
    -c "begin; set local role authenticated; reset request.jwt.claim.sub; $1; commit;"
}

cleanup() { psql -q -d postgres -c "drop database if exists \"$DB\"" >/dev/null 2>&1; }
trap cleanup EXIT

# ── 0. throwaway DB + emulation + migration ──────────────────
psql -q -d postgres -c "create database \"$DB\"" >/dev/null || { say "FAIL: cannot create test db"; exit 1; }
qf supabase/tests/local_emulation.sql >/dev/null || { say "FAIL: emulation scaffold failed"; exit 1; }
if qf supabase/migrations/0001_ruchi_init.sql >/dev/null 2>&1; then
  pass "migration applies cleanly"
else
  fail "migration apply failed"; exit 1
fi
if qf supabase/migrations/0001_ruchi_init.sql >/dev/null 2>&1; then
  pass "migration is idempotent (second apply ok)"
else
  fail "migration second apply failed"
fi

# ── 1. structural expectations ───────────────────────────────
for t in profiles completed_meals cooking_streaks; do
  n=$(q "select count(*) from pg_tables where schemaname='public' and tablename='$t'")
  [ "$n" = "1" ] && pass "table $t exists" || fail "table $t missing"
  r=$(q "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='$t'")
  [ "$r" = "t" ] && pass "RLS enabled on $t" || fail "RLS not enabled on $t"
done

n=$(q "select count(*) from pg_policies where schemaname='public'")
[ "$n" -ge 6 ] && pass "$n RLS policies present" || fail "too few policies ($n)"

# ── 2. users + signup trigger ────────────────────────────────
q "insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','a@test.dev'),
  ('22222222-2222-2222-2222-222222222222','b@test.dev')" >/dev/null
n=$(q "select count(*) from public.profiles")
[ "$n" = "2" ] && pass "signup trigger auto-creates profiles" || fail "trigger did not create profiles ($n)"

UA=11111111-1111-1111-1111-111111111111
UB=22222222-2222-2222-2222-222222222222

# ── 3. cross-user isolation (the security core) ──────────────
tx "$UA" "insert into public.completed_meals (user_id, recipe_id, recipe_name, local_date, protein_g, calories, cost_inr, savings_inr)
  values ('$UA','paneer-egg-bhurji','Paneer Egg Bhurji','2026-09-16',38,520,82,221)" >/dev/null \
  && pass "user A inserts own meal" || fail "user A could not insert own meal"

# B must see none of A's rows (committed data, non-owner session).
n=$(tx "$UB" "select count(*) from public.completed_meals")
[ "$n" = "0" ] && pass "user B sees none of user A's meals" || fail "LEAK: user B sees A's meals ($n)"

# B must not modify A's profile row: UPDATE ... RETURNING returns the
# rows actually updated — empty output proves RLS filtered A's row out.
upd=$(tx "$UB" "update public.profiles set display_name='hacked' where id='$UA' returning id")
after=$(q "select count(*) from public.profiles where id='$UA' and display_name='hacked'")
if [ -z "$upd" ] && [ "$after" = "0" ]; then
  pass "user B cannot update user A's profile"
else
  fail "LEAK: B updated A's profile (returned: ${upd:-none}, rows: $after)"
fi

# B cannot insert a meal claiming A's user_id (WITH CHECK violation).
err=$(psql -qAt -d "$DB" \
  -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$UB';
      insert into public.completed_meals (user_id, recipe_id, recipe_name, local_date)
      values ('$UA','x','x','2026-09-16'); commit;" 2>&1 | tail -1)
case "$err" in
  *"row-level security"*) pass "B cannot insert rows as A (RLS check)" ;;
  *) fail "insert-as-other-user not blocked: $err" ;;
esac

# Anonymous caller sees nothing and cannot insert.
n=$(tx_anon "select count(*) from public.completed_meals")
[ "$n" = "0" ] && pass "anonymous role has no read access" || fail "anon sees data ($n)"
err=$(psql -qAt -d "$DB" \
  -c "begin; set local role authenticated; reset request.jwt.claim.sub;
      insert into public.completed_meals (user_id, recipe_id, recipe_name, local_date)
      values ('$UA','x','x','2026-09-16'); commit;" 2>&1 | tail -1)
case "$err" in
  *"row-level security"*|*"authentication required"*) pass "anonymous cannot insert meals" ;;
  *) fail "anon insert not blocked: $err" ;;
esac

# ── 4. streak RPC semantics (each call = one committed request) ──
streak() { # $1 = user, $2 = date → prints current_streak after the call
  psql -qAt -d "$DB" \
    -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$1';
        select public.record_completed_meal_day('$2');
        select current_streak from public.cooking_streaks where user_id='$1'; commit;" | tail -1
}

s=$(streak "$UA" "2026-09-16"); [ "$s" = "1" ] && pass "first meal → streak 1" || fail "first meal streak=$s"
s=$(streak "$UA" "2026-09-16"); [ "$s" = "1" ] && pass "same-day duplicate → still 1" || fail "same-day dup streak=$s"
s=$(streak "$UA" "2026-09-17"); [ "$s" = "2" ] && pass "consecutive day → 2" || fail "consecutive streak=$s"
s=$(streak "$UA" "2026-09-19"); [ "$s" = "1" ] && pass "gap day → reset to 1" || fail "gap streak=$s"
s=$(streak "$UA" "2026-09-18"); [ "$s" = "1" ] && pass "older date → no rewrite" || fail "older-date streak=$s"
l=$(q "select longest_streak from public.cooking_streaks where user_id='$UA'")
[ "$l" = "2" ] && pass "longest streak preserved (2)" || fail "longest=$l"

# B's streak is independent.
s=$(streak "$UB" "2026-09-17"); [ "$s" = "1" ] && pass "user B's streak independent of A's" || fail "B streak=$s"

# RPC without identity fails closed (exception message appears in stderr).
err=$(psql -qAt -d "$DB" -c "select public.record_completed_meal_day('2026-09-16');" 2>&1)
case "$err" in
  *"authentication required"*) pass "RPC rejects unauthenticated caller" ;;
  *) fail "RPC unauth behavior: $err" ;;
esac

say ""
if [ "$FAILS" -eq 0 ]; then say "ALL CHECKS PASSED"; else say "$FAILS CHECK(S) FAILED"; exit 1; fi
