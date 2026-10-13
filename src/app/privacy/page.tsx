// ─────────────────────────────────────────────────────────────
// RUCHI — privacy & account deletion information
// ─────────────────────────────────────────────────────────────
// Mirrors the app's actual data flows. Anything here is documented because
// it genuinely happens in this codebase, not because a policy template
// demanded a paragraph.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy & account deletion · RUCHI",
  description:
    "How RUCHI handles your data: local-first storage, Supabase auth and cloud sync, ingredient photos sent for AI analysis, and how to delete your account.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 text-[15px] leading-relaxed text-ink">
      <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-flame">RUCHI</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Privacy & account deletion</h1>
      <p className="mt-3 text-muted">
        RUCHI is a small cooking app. This page explains what we store, where it lives, and how you can remove it.
        It reflects how this version of the app actually works, not a generic template.
      </p>

      <h2 className="mt-10 font-display text-xl font-semibold">What RUCHI stores and why</h2>

      <h3 className="mt-6 font-semibold">On this device (local-first)</h3>
      <p className="mt-1 text-muted">
        Most of the app works without an account. When you use it, your kitchen, meal history, preferences, and
        some UI state are kept in your browser&apos;s local storage so the app feels fast and works offline. That data
        stays on your device. It is not automatically copied to any server unless you sign in.
      </p>

      <h3 className="mt-6 font-semibold">Account and cloud sync (Supabase)</h3>
      <p className="mt-1 text-muted">
        When you sign in, RUCHI uses Supabase Auth for sign-in and stores durable account data in Supabase tables
        protected by row-level security. That includes your profile, completed meals, cooking streaks, and
        notification preferences. The app treats the cloud as a mirror of your data, not as the only copy — local
        changes apply immediately and sync in the background.
      </p>
      <p className="mt-2 text-muted">
        RUCHI uses the browser&apos;s Supabase client with the publishable key. The service-role key used for privileged
        server operations never leaves the server.
      </p>

      <h3 className="mt-6 font-semibold">Ingredient photos sent for AI analysis</h3>
      <p className="mt-1 text-muted">
        When you scan or upload a photo of ingredients, the app prepares the image and sends it to a server route
        that uses an AI vision model to help identify what is in your kitchen. Those images are processed to power
        the feature; they are not saved as a personal photo gallery for you. If you do not want to use this feature,
        you can cook from your kitchen or search without uploading photos.
      </p>

      <h3 className="mt-6 font-semibold">Profile and dietary information</h3>
      <p className="mt-1 text-muted">
        If you sign in, RUCHI stores the preferences you choose — things like diet, cooking skill, fitness goal,
        default servings, and budget — so your recommendations and meals reflect what you told us. You can change
        these at any time in your profile.
      </p>

      <h3 className="mt-6 font-semibold">Meal history</h3>
      <p className="mt-1 text-muted">
        When you finish a meal while signed in, RUCHI records what you cooked, when, and the app&apos;s estimate of
        protein, calories, cost, and savings. This is what powers your cooking stats and streak. Completed-meal
        records are append-only in the app&apos;s design — the app does not let you silently overwrite history.
      </p>

      <h3 className="mt-6 font-semibold">Notifications</h3>
      <p className="mt-1 text-muted">
        If you choose to enable notifications, RUCHI asks for the minimum access needed for that channel and keeps
        notification preferences on the server. Notifications are off by default. If push is not configured on the
        server, the app will tell you honestly rather than pretending it is working.
      </p>

      <h3 className="mt-6 font-semibold">What RUCHI does not do</h3>
      <ul className="mt-1 space-y-1 list-disc list-inside text-muted">
        <li>It does not sell your data.</li>
        <li>It does not use your account or meals to train AI models as part of this app&apos;s documented behavior.</li>
        <li>It does not claim to delete data from external providers beyond what the app actually controls.</li>
      </ul>

      <h2 className="mt-10 font-display text-xl font-semibold">How to delete your account</h2>
      <p className="mt-1 text-muted">
        If you signed in with Supabase, you can permanently delete your RUCHI account from your profile screen.
        Deleting your account removes your Supabase Auth account and, through the database relationships in this
        app, your associated profile, completed meals, streaks, and notification preferences.
      </p>
      <p className="mt-2 text-muted">
        Account deletion is irreversible. The app asks you to confirm before making the request, shows a loading
        state while it is in progress, and returns you to the home screen afterward. If the request fails, the app
        shows a clear error and lets you try again.
      </p>
      <p className="mt-2 text-muted">
        If you used RUCHI without signing in, your data lives only on this device. Removing the app or clearing the
        browser&apos;s local storage removes that local data.
      </p>

      <h2 className="mt-10 font-display text-xl font-semibold">Data you should know about</h2>
      <p className="mt-1 text-muted">
        Because RUCHI sends ingredient photos to an AI service for analysis, and because Supabase handles
        authentication and storage, the app&apos;s data footprint is shared with those services in the normal course of
        using them. This page describes RUCHI&apos;s use of your data; it does not restate the separate terms or privacy
        practices of Supabase or the AI provider.
      </p>

      <p className="mt-10 border-t border-line pt-6 text-muted">
        RUCHI gives estimates, not medical or financial advice.{' '}
        <Link
          href="/"
          className="underline hover:text-ink"
        >
          Back to RUCHI
        </Link>
      </p>
    </div>
  );
}
