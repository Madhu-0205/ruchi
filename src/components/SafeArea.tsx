"use client";

import { useEffect } from "react";
import { useScreen } from "@/lib/store/screens";
import HomeScreen from "@/components/screens/HomeScreen";
import DiscoverScreen from "@/components/screens/DiscoverScreen";
import KitchenScreen from "@/components/screens/KitchenScreen";
import ProfileScreen from "@/components/screens/ProfileScreen";
import MealDetailScreen from "@/components/screens/MealDetailScreen";
import CookingMode from "@/components/screens/CookingMode";
import ScanScreen from "@/components/screens/ScanScreen";
import BottomNav from "@/components/BottomNav";

export default function SafeArea({ children }: { children: React.ReactNode }) {
  const screen = useScreen((s) => s.screen);
  const hydrate = useScreen((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Cooking Mode takes over the viewport — lock page scroll behind it.
  useEffect(() => {
    document.body.classList.toggle("cooking-lock", screen === "cooking");
    return () => document.body.classList.remove("cooking-lock");
  }, [screen]);

  const showNav =
    screen === "home" || screen === "discover" || screen === "kitchen" || screen === "profile";

  return (
    <div className="min-h-dvh">
      <div className="mx-auto w-full max-w-md px-4 pb-24">
        {screen === "home" && <HomeScreen />}
        {screen === "discover" && <DiscoverScreen />}
        {screen === "kitchen" && <KitchenScreen />}
        {screen === "profile" && <ProfileScreen />}
        {screen === "meal" && <MealDetailScreen />}
        {screen === "scan" && <ScanScreen />}
      </div>
      {showNav && <BottomNav />}
      {screen === "cooking" && <CookingMode />}
      {/* children kept for SSR shell parity */}
      <span hidden>{children}</span>
    </div>
  );
}
