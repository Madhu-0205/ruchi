"use client";

// ─────────────────────────────────────────────────────────────
// RUCHI — app shell: boot splash gate + auth flow routing
// ─────────────────────────────────────────────────────────────
// Startup sequence: the static splash (layout.tsx) stays visible until
// the Supabase session check settles, THEN the right experience renders
// — authenticated users land in the app with no sign-in flash, fresh
// visitors get the welcome gate. The splash is removed only after the
// first settled state (never again during internal navigation), with a
// safety cap so a hung network can never trap the user on the splash.

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { deriveAuthFlowState, useRuchi } from "@/lib/store";
import { useScreen } from "@/lib/store/screens";
import HomeScreen from "@/components/screens/HomeScreen";
import DiscoverScreen from "@/components/screens/DiscoverScreen";
import KitchenScreen from "@/components/screens/KitchenScreen";
import ProfileScreen from "@/components/screens/ProfileScreen";
import MealDetailScreen from "@/components/screens/MealDetailScreen";
import CookingMode from "@/components/screens/CookingMode";
import ScanScreen from "@/components/screens/ScanScreen";
import BottomNav from "@/components/BottomNav";
import TopNav from "@/components/TopNav";
import WelcomeGate from "@/components/WelcomeGate";
import { PageTransition } from "@/components/motion";

/** Max ms the splash may hold before falling through to the real UI. */
const SPLASH_CAP_MS = 4000;

export default function SafeArea({ children }: { children: React.ReactNode }) {
  const screen = useScreen((s) => s.screen);
  const hydrate = useScreen((s) => s.hydrate);

  // Subscribe to the flags the auth state machine derives from.
  useRuchi((s) => s.authReady);
  useRuchi((s) => s.account);
  useRuchi((s) => s.recoveryMode);
  useRuchi((s) => s.pendingConfirmationEmail);
  useRuchi((s) => s.guestMode);
  const authFlow = deriveAuthFlowState(useRuchi.getState());

  const [capFired, setCapFired] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Safety cap, armed once on mount: even if the session check hangs
  // (offline, very slow network), the splash can never trap the user —
  // the auth card's own authReady skeletons take over as the honest
  // loading state.
  useEffect(() => {
    const t = setTimeout(() => setCapFired(true), SPLASH_CAP_MS);
    return () => clearTimeout(t);
  }, []);

  // The splash is DERIVED, not toggled: visible only while the session
  // check is unsettled AND the cap hasn't fired. It can never reappear —
  // neither input flips back during internal navigation.
  const splashUp = !capFired && authFlow === "initializing";

  // Cooking Mode takes over the viewport — lock page scroll behind it.
  useEffect(() => {
    document.body.classList.toggle("cooking-lock", screen === "cooking");
    return () => document.body.classList.remove("cooking-lock");
  }, [screen]);

  // App has mounted — the static boot splash is superseded by this gate.
  useEffect(() => {
    document.getElementById("boot-splash")?.remove();
  }, []);

  const showNav =
    screen === "home" || screen === "discover" || screen === "kitchen" || screen === "profile";

  // While the splash is up, render nothing behind it (cheap, and no
  // flash of unauthenticated or authenticated content underneath).
  if (splashUp) return <span hidden>{children}</span>;

  // Welcome gate covers every pre-auth state: fresh visitor, just signed
  // out, recovery-link landing, and post-signup confirmation notice. The
  // main app (with the user's data) mounts only for authenticated users
  // and deliberate guest mode — no private UI can flash.
  const gated =
    authFlow === "unauthenticated" ||
    authFlow === "recovery" ||
    authFlow === "confirmation-required";

  // Top nav replaces the bottom bar on desktop; both render their own
  // breakpoint visibility classes.
  const nav = gated ? null : showNav ? (
    <>
      <div className="hidden lg:block">
        <TopNav />
      </div>
      <div className="lg:hidden">
        <BottomNav />
      </div>
    </>
  ) : null;

  return (
    <div className="grain min-h-dvh">
      {nav}
      <main className="relative z-[1] mx-auto w-full max-w-md px-4 pb-28 lg:max-w-6xl lg:px-8 lg:pb-16">
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition screenKey={screen}>
            {gated ? (
              <WelcomeGate showGuestExit={authFlow === "unauthenticated"} />
            ) : (
              <>
                {screen === "home" && <HomeScreen />}
                {screen === "discover" && <DiscoverScreen />}
                {screen === "kitchen" && <KitchenScreen />}
                {screen === "profile" && <ProfileScreen />}
                {screen === "meal" && <MealDetailScreen />}
                {screen === "scan" && <ScanScreen />}
              </>
            )}
          </PageTransition>
        </AnimatePresence>
        {/* children kept for SSR shell parity */}
        <span hidden>{children}</span>
      </main>
      {screen === "cooking" && <CookingMode />}
    </div>
  );
}
