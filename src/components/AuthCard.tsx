"use client";

// ─────────────────────────────────────────────────────────────
// RUCHI — shared auth card (sign in / sign up / forgot password)
// ─────────────────────────────────────────────────────────────
// One form, used by the welcome gate and the Profile screen's guest
// view — the sign-in experience is identical wherever it appears.
// Supabase is the only auth authority here: every outcome comes from
// the store's Supabase-backed actions, errors are pre-classified into
// human copy, and no password/email ever touches persistent storage.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Note } from "@/components/ui";
import { RuchiLogo } from "@/components/RuchiLogo";
import { useRuchi } from "@/lib/store";
import { authAvailable, authErrorMessage, type AuthFailure } from "@/lib/auth/supabase-auth";

type Mode = "sign-in" | "sign-up" | "forgot";

const authErrorCopy: Record<AuthFailure, string> = {
  "invalid-credentials": authErrorMessage("invalid-credentials"),
  "email-not-confirmed": authErrorMessage("email-not-confirmed"),
  "email-taken": authErrorMessage("email-taken"),
  "weak-password": authErrorMessage("weak-password"),
  "password-reuse": authErrorMessage("password-reuse"),
  "rate-limited": authErrorMessage("rate-limited"),
  network: authErrorMessage("network"),
  unconfigured: authErrorMessage("unconfigured"),
  error: authErrorMessage("error"),
};

export default function AuthCard({ showGuestExit = false }: { showGuestExit?: boolean }) {
  const {
    authError,
    authReady,
    recoveryMode,
    pendingConfirmationEmail,
    dismissConfirmationNotice,
    dismissRecovery,
    enterGuestMode,
    signIn,
    signUp,
    requestPasswordReset,
    setNewPassword,
  } = useRuchi();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetRequestedFor, setResetRequestedFor] = useState<string | null>(null);
  const configured = authAvailable();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (recoveryMode) {
        // Arrived via a reset-email link: swap the password inside the
        // recovery session. The store clears recoveryMode only on success.
        await setNewPassword(password);
        if (!useRuchi.getState().recoveryMode) {
          setPassword("");
          setNotice("Password updated — you're all set. Sign in with the new one.");
        }
      } else if (mode === "sign-up") {
        // The store's signUp reports "needs-email-confirmation" as its own
        // outcome (never a fake signed-in state) so the UI can say exactly
        // what happened: account created, awaiting the confirmation link.
        const outcome = await signUp(email.trim(), password);
        if (outcome === "needs-email-confirmation") {
          setNotice(`Check ${email.trim()} to confirm your email, then sign in.`);
        }
      } else if (mode === "forgot") {
        const outcome = await requestPasswordReset(email.trim());
        // Honest by design: "sent" means the request was accepted, not
        // that the address has an account. No user enumeration.
        if (outcome === "sent") {
          setNotice(null);
          setResetRequestedFor(email.trim());
        }
      } else {
        await signIn(email.trim(), password);
      }
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-[15px] shadow-soft outline-none transition-colors focus:border-ink/40";

  if (!configured) {
    return (
      <div>
        <p className="text-[15px] font-bold">Save your cooking progress.</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Accounts aren&apos;t set up in this build yet — everything still works on this device,
          and your progress is saved locally.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Official icon-only mark — centered, modest, same product. */}
      <div className="mb-3 flex justify-center">
        <RuchiLogo size={44} />
      </div>
      <p className="text-center font-display text-[19px] font-semibold tracking-tight">
        {recoveryMode
          ? "Set a new password."
          : mode === "forgot"
            ? "Reset your password."
            : "Save your cooking progress."}
      </p>
      <p className="mt-1.5 text-center text-[13px] leading-relaxed text-muted">
        {recoveryMode
          ? "Choose something you'll remember — it replaces the old one."
          : mode === "forgot"
            ? "We'll email you a link to set a new password."
            : "Keep your streak, meals and preferences safe — and follow you to any device."}
      </p>

      {pendingConfirmationEmail && (
        <div className="mt-3">
          <Note tone="sage">
            Check {pendingConfirmationEmail} to confirm your email, then sign in. Didn&apos;t get
            it? Look in spam, or sign up again to resend.
          </Note>
          <button
            type="button"
            onClick={dismissConfirmationNotice}
            className="mt-1.5 w-full text-center text-[12px] text-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="mt-3">
          <Note tone="sage">{notice}</Note>
        </div>
      )}
      {authError && (
        <div className="mt-3">
          <Note tone="flame">{authErrorCopy[authError]}</Note>
        </div>
      )}

      {!authReady ? (
        // Session check still settling — hold the real form back. Mounting
        // it early means a late-restoring session would unmount this subtree
        // mid-typing and silently discard what was typed. Non-interactive
        // skeletons, no fake affordance.
        <div className="mt-4 space-y-2.5" aria-hidden="true">
          <div className="h-[52px] animate-pulse-soft rounded-2xl border border-line bg-surface" />
          <div className="h-[52px] animate-pulse-soft rounded-2xl border border-line bg-surface" />
          <div className="h-[52px] animate-pulse-soft rounded-2xl bg-ink/10" />
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-2">
          {!recoveryMode && (
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClass}
            />
          )}
          <input
            type="password"
            required
            minLength={6}
            autoComplete={recoveryMode || mode === "sign-up" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              recoveryMode ? "New password" : mode === "sign-up" ? "Create a password" : "Password"
            }
            className={inputClass}
          />
          <Button type="submit" className="mt-1 w-full py-3.5" disabled={busy}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {recoveryMode
              ? "Save new password"
              : mode === "sign-up"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset link"
                  : "Sign in"}
          </Button>

          {mode === "forgot" && resetRequestedFor && (
            <Note tone="sage">
              If {resetRequestedFor} has an account, a reset link is on its way. Check your spam
              folder if it doesn&apos;t arrive in a few minutes.
            </Note>
          )}

          {!recoveryMode && mode === "sign-in" && (
            <button
              type="button"
              onClick={() => setMode("forgot")}
              className="w-full text-center text-[12px] text-muted hover:text-ink"
            >
              Forgot password?
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setResetRequestedFor(null);
              if (recoveryMode) {
                dismissRecovery();
              } else {
                setMode(
                  mode === "sign-up" ? "sign-in" : mode === "forgot" ? "sign-in" : "sign-up",
                );
              }
            }}
            className="w-full text-center text-[12px] text-muted hover:text-ink"
          >
            {recoveryMode
              ? "Back to sign in"
              : mode === "sign-up"
                ? "Already have an account? Sign in"
                : mode === "forgot"
                  ? "Back to sign in"
                  : "New here? Create an account"}
          </button>
        </form>
      )}

      {showGuestExit && (
        <button
          type="button"
          onClick={enterGuestMode}
          className="mt-4 w-full rounded-2xl border border-sage/25 bg-sage-soft py-3 text-[13.5px] font-semibold text-sage transition-colors hover:bg-sage/15 hover:text-ink"
        >
          Continue without an account →
        </button>
      )}

      {!showGuestExit && (
        <p className="mt-2 text-center text-[11px] text-muted">
          You can cook everything without an account. This just backs it up.
        </p>
      )}
    </div>
  );
}
