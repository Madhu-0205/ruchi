"use client";

import { Home, Search, Refrigerator, User } from "lucide-react";
import { useScreen } from "@/lib/store/screens";

const TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "discover", label: "Discover", Icon: Search },
  { id: "kitchen", label: "Kitchen", Icon: Refrigerator },
  { id: "profile", label: "Profile", Icon: User },
] as const;

export default function BottomNav() {
  const screen = useScreen((s) => s.screen);
  const go = useScreen((s) => s.go);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cream/95 backdrop-blur">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-6 pb-[max(env(safe-area-inset-bottom),10px)] pt-2">
        {TABS.map(({ id, label, Icon }) => {
          const active = screen === id;
          return (
            <button
              key={id}
              onClick={() => go(id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                active ? "text-ink" : "text-muted/70 hover:text-muted"
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
              {label}
              <span
                className={`h-0.5 w-5 rounded-full transition-all ${active ? "bg-flame" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </div>
      {/* screen label (a11y) */}
      <span className="sr-only">{TABS.find((t) => t.id === screen)?.label}</span>
    </nav>
  );
}
