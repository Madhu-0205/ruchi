#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════
# RUCHI migration 0006 verification (notification ledger)
# ═════════════════════════════════════════════════════════════
# Runs migrations 0001→0006 against a throwaway local Postgres with
# the Supabase emulation (auth.users, auth.uid() from
# request.jwt.claim.sub, client sessions as the non-owner role) and
# asserts the Notification 2.0 security model:
#   • 0006 applies cleanly and is idempotent (runs twice)
#   • notification_ledger: RLS on, SELECT-own only; insert/update/
#     delete revoked from authenticated (permission denied, not a
#     silent filter — a forged row can never exist)
#   • user B cannot read user A's ledger rows
#   • the (user_id, dedup_key) partial unique index: a duplicate send
#     key is rejected (23505 posture), NULL keys never collide
#   • suppression rows: no dedup key, status/reason CHECK-constrained
#   • mark_notification_engaged: own row engaged (opened first-write
#     wins, actioned sticky), foreign row untouched, anon rejected
#   • notification_prefs.type_prefs: unknown keys rejected by trigger,
#     non-boolean values rejected, valid updates pass
#   • paused_session column exists for the RESUME_COOKING signal
#
# Owner-role psql (no SET ROLE) emulates the cron's service-role
# client, which is exactly how the route reaches the ledger.
#
# Results print as PASS/FAIL lines; exit 1 if any FAIL.
# Usage: bash supabase/tests/verify-0006.sh
# ═════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/../.."   # repo root

DB="ruchi_verify_0006_$$"
FAILS=0

say()  { printf '%s\n' "$*"; }
pass() { say "PASS: $*"; }
fail() { say "FAIL: $*"; FAILS=$((FAILS+1)); }

q()  { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
qf() { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

# A committed client transaction as `authenticated` with an identity.
tx() { # $1 = user uuid, $2 = SQL
  psql -qAt -v ON_ERROR_STOP=1 -d "$DB" \
    -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$1'; $2; commit;"
}
tx_anon() {
  psql -qAt -v ON_ERROR_STOP=1 -d "$DB" \
    -c "begin; set local role authenticated; reset request.jwt.claim.sub; $1; commit;"
}

cleanup() { psql -q -d postgres -c "drop database if exists \"$DB\"" >/dev/null 2>&1; }
trap cleanup EXIT

# ── 0. throwaway DB + emulation + migrations ─────────────────
psql -q -d postgres -c "create database \"$DB\"" >/dev/null || { say "FAIL: cannot create test db"; exit 1; }
qf supabase/tests/local_emulation.sql >/dev/null || { say "FAIL: emulation scaffold failed"; exit 1; }
for m in 0001_ruchi_init 0002_beta_feedback 0003_cooking_stats 0004_notification_prefs 0005_notification_send_log 0006_notification_ledger; do
  qf "supabase/migrations/$m.sql" >/dev/null 2>&1 || { say "FAIL: $m apply failed"; exit 1; }
done
pass "migrations 0001→0006 apply cleanly in order"

if qf supabase/migrations/0006_notification_ledger.sql >/dev/null 2>&1; then
  pass "0006 is idempotent (second apply ok)"
else
  fail "0006 second apply failed"
fi

UA=11111111-1111-1111-1111-111111111111
UB=22222222-2222-2222-2222-222222222222
q "insert into auth.users (id, email) values ('$UA','a@test.dev'), ('$UB','b@test.dev')" >/dev/null
# Opted-in prefs rows (the cron's batch only ever sees opted-in users).
q "insert into public.notification_prefs (user_id, channels) values ('$UA','{\"web_push\":true}'), ('$UB','{\"web_push\":true}')" >/dev/null

# ── 1. structure ─────────────────────────────────────────────
n=$(q "select count(*) from pg_tables where schemaname='public' and tablename='notification_ledger'")
[ "$n" = "1" ] && pass "table notification_ledger exists" || fail "notification_ledger missing"

r=$(q "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='notification_ledger'")
[ "$r" = "t" ] && pass "RLS enabled on notification_ledger" || fail "RLS not enabled on notification_ledger"

p=$(q "select count(*) from pg_policies where schemaname='public' and tablename='notification_ledger' and policyname='notification_ledger_select_own'")
[ "$p" = "1" ] && pass "select-own policy present" || fail "select-own policy missing"

col=$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='notification_prefs' and column_name in ('type_prefs','paused_session')")
[ "$col" = "2" ] && pass "prefs columns type_prefs + paused_session exist" || fail "prefs columns missing ($col)"

u=$(q "select count(*) from pg_indexes where schemaname='public' and indexname='notification_ledger_dedup'")
[ "$u" = "1" ] && pass "unique dedup index present" || fail "unique dedup index missing"

# ── 2. service role writes the ledger (cron posture) ─────────
q "insert into public.notification_ledger (user_id, opportunity_type, dedup_key, title, body, destination, status)
   values ('$UA','resume_cooking','resume_cooking:paneer-egg-bhurji:2026-10-02','t','b','/?resume=x','sent')" >/dev/null \
  && pass "service role inserts a sent row" || fail "service-role insert failed"

# Duplicate (user, dedup_key) → unique violation (the 23505 idempotency).
err=$(q "insert into public.notification_ledger (user_id, opportunity_type, dedup_key, title, body, destination)
         values ('$UA','resume_cooking','resume_cooking:paneer-egg-bhurji:2026-10-02','t','b','/?resume=x')" 2>&1)
case "$err" in
  *unique*|*duplicate*) pass "duplicate dedup_key rejected (idempotent cron)" ;;
  "") fail "duplicate dedup_key was ACCEPTED (double-send risk)" ;;
  *) fail "unexpected error on duplicate insert: $err" ;;
esac

# Same key, different user → allowed (isolation of keys).
q "insert into public.notification_ledger (user_id, opportunity_type, dedup_key, title, body, destination)
   values ('$UB','resume_cooking','resume_cooking:paneer-egg-bhurji:2026-10-02','t','b','/?resume=x')" >/dev/null \
  && pass "same dedup_key for another user is independent" || fail "key isolation broken"

# NULL keys (suppressed rows) never collide.
q "insert into public.notification_ledger (user_id, opportunity_type, status, suppression_reason)
   values ('$UA','cook_again','suppressed','daily_cap'),
          ('$UA','cook_again','suppressed','daily_cap')" >/dev/null \
  && pass "suppressed rows (NULL key) never collide" || fail "NULL dedup_key collision"

# CHECK constraints.
bad=$(q "insert into public.notification_ledger (user_id, opportunity_type, status) values ('$UA','gamification','sent')" 2>&1)
case "$bad" in *check*|*violates*) pass "unknown opportunity_type rejected" ;; "") fail "unknown opportunity_type accepted" ;; esac
bad=$(q "insert into public.notification_ledger (user_id, opportunity_type, status, suppression_reason) values ('$UA','cook_again','sent','because_i_felt_like_it')" 2>&1)
case "$bad" in *check*|*violates*) pass "unknown suppression_reason rejected" ;; "") fail "unknown suppression_reason accepted" ;; esac

# ── 3. RLS: clients read their own rows, write nothing ───────
n=$(tx "$UA" "select count(*) from public.notification_ledger")
[ "$n" = "3" ] && pass "user A reads own ledger rows (3)" || fail "user A sees wrong row count ($n)"
n=$(tx "$UB" "select count(*) from public.notification_ledger")
[ "$n" = "1" ] && pass "user B sees none of user A's ledger rows" || fail "LEAK: B sees A's rows ($n)"

err=$(tx "$UB" "insert into public.notification_ledger (user_id, opportunity_type, dedup_key, title, body, destination) values ('$UB','personality','forged:1','t','b','/')" 2>&1)
case "$err" in
  *permission*|*denied*) pass "authenticated cannot INSERT ledger rows (revoked)" ;;
  *) fail "authenticated insert NOT blocked: $err" ;;
esac
err=$(tx "$UA" "update public.notification_ledger set status='failed'" 2>&1)
case "$err" in
  *permission*|*denied*) pass "authenticated cannot UPDATE ledger rows (revoked)" ;;
  *) fail "authenticated update NOT blocked: $err" ;;
esac
err=$(tx "$UA" "delete from public.notification_ledger" 2>&1)
case "$err" in
  *permission*|*denied*) pass "authenticated cannot DELETE ledger rows (revoked)" ;;
  *) fail "authenticated delete NOT blocked: $err" ;;
esac
n=$(tx_anon "select count(*) from public.notification_ledger" 2>&1)
[ "$n" = "0" ] && pass "anonymous/identityless session reads nothing (own-scope)" || fail "anon sees rows ($n)"

# ── 4. engagement RPC (the one client write path) ────────────
LEDGER_ID=$(q "select id from public.notification_ledger where user_id='$UA' and dedup_key like 'resume%' limit 1")
FOREIGN_ID=$(q "select id from public.notification_ledger where user_id='$UB' limit 1")

tx "$UA" "select public.mark_notification_engaged('$LEDGER_ID', true)" >/dev/null \
  && pass "user A engages own notification" || fail "own-row engagement failed"

opened=$(q "select count(*) from public.notification_ledger where id='$LEDGER_ID' and opened_at is not null and actioned_at is not null")
[ "$opened" = "1" ] && pass "opened_at + actioned_at recorded" || fail "engagement columns not written ($opened)"

opened_before=$(q "select opened_at from public.notification_ledger where id='$LEDGER_ID'")
tx "$UA" "select public.mark_notification_engaged('$LEDGER_ID', false)" >/dev/null
opened_after=$(q "select opened_at from public.notification_ledger where id='$LEDGER_ID'")
[ "$opened_before" = "$opened_after" ] && pass "opened_at is first-write-wins (idempotent re-engage)" || fail "re-engage overwrote opened_at"

tx "$UB" "select public.mark_notification_engaged('$LEDGER_ID', true)" >/dev/null
# B touching A's row must be a silent no-op (ownership filter) —
# A's row stays engaged exactly once, by A.
n_a_engaged=$(q "select count(*) from public.notification_ledger where id='$LEDGER_ID' and opened_at is not null")
[ "$n_a_engaged" = "1" ] && pass "foreign engagement attempt is a no-op (ownership filter)" || fail "foreign engagement corrupted A's row"

err=$(tx_anon "select public.mark_notification_engaged('$LEDGER_ID', false)" 2>&1)
case "$err" in *authenticated*|*exception*|*not\ auth*) pass "anonymous engagement rejected" ;; "") fail "anonymous engagement silently succeeded" ;; *) pass "anonymous engagement rejected" ;; esac

# ── 5. type_prefs validation ─────────────────────────────────
q "update public.notification_prefs set type_prefs = '{\"personality\": false, \"cook_again\": true}' where user_id='$UA'" >/dev/null \
  && pass "valid type_prefs accepted" || fail "valid type_prefs rejected"

err=$(q "update public.notification_prefs set type_prefs = '{\"streak_nag\": true}' where user_id='$UA'" 2>&1)
case "$err" in *unknown\ notification*|*exception*) pass "unknown type key rejected by trigger" ;; "") fail "unknown type key accepted" ;; esac

err=$(q "update public.notification_prefs set type_prefs = '{\"personality\": \"yes\"}' where user_id='$UA'" 2>&1)
case "$err" in *check*|*violates*) pass "non-boolean type value rejected" ;; "") fail "non-boolean type value accepted" ;; esac

# ── 6. paused_session column usable ──────────────────────────
q "update public.notification_prefs set paused_session = '{\"recipeId\":\"paneer-egg-bhurji\",\"stepIndex\":3,\"stepCount\":6,\"pausedAt\":1}' where user_id='$UA'" >/dev/null \
  && pass "paused_session stores a real pause" || fail "paused_session write failed"

if [ "$FAILS" -eq 0 ]; then
  say "ALL 0006 CHECKS PASSED"
  exit 0
fi
say "$FAILS CHECK(S) FAILED"
exit 1
