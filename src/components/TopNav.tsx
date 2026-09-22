"use client";

import { ScanLine } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useScreen, type Screen } from "@/lib/store/screens";
import { RuchiLogo } from "@/components/RuchiLogo";

const TABS: { id: Screen; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "discover", label: "Discover" },
  { id: "kitchen", label: "Kitchen" },
  { id: "profile", label: "Profile" },
];

export default function TopNav() {
  const screen = useScreen((s) => s.screen);
  const go = useScreen((s) => s.go);
  const reduce = useReducedMotion();

  return (
    <header className="glass sticky top-0 z-40 border-b border-line/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6 lg:px-8">
        {/* Wordmark */}
        <button
          onClick={() => go("home")}
          className="flex items-center gap-2.5"
          aria-label="RUCHI home"
        >
          <RuchiLogo size={30} priority />
          <span className="font-display text-[19px] font-semibold tracking-tight">RUCHI</span>
          <span aria-hidden className="mb-0.5 hidden text-[15px] text-flame sm:inline">·</span>
          <span aria-hidden className="hidden text-[13px] font-medium text-muted sm:inline">
            రుచి
          </span>
        </button>

        {/* Center tabs */}
        <nav aria-label="Primary" className="flex items-center gap-1">
          {TABS.map(({ id, label }) => {
            const active = screen === id;
            return (
              <button
                key={id}
                onClick={() => go(id)}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-4 py-2 text-[14px] font-semibold transition-colors duration-150 ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {active &&
                  (reduce ? (
                    <span className="absolute inset-0 -z-10 rounded-full bg-ink/[0.06]" />
                  ) : (
                    <motion.span
                      layoutId="topnav-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-ink/[0.06]"
                      transition={{ type: "spring", damping: 30, stiffness: 350 }}
                    />
                  ))}
                {label}
              </button>
            );
          })}
        </nav>

        {/* Scan CTA */}
        <button
          onClick={() => go("scan")}
          className="inline-flex items-center gap-2 rounded-full bg-flame px-4 py-2.5 text-[14px] font-semibold text-white shadow-cta transition-all duration-200 hover:bg-flame-deep active:scale-[0.97]"
        >
          <ScanLine size={16} strokeWidth={2.2} />
          Scan
        </button>
      </div>
    </header>
  );
}
