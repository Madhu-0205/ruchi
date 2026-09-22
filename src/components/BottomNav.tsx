"use client";

import { Home, Search, ScanLine, Refrigerator, User } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
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
  const reduce = useReducedMotion();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cream/92 backdrop-blur-md"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between px-4 pb-[max(env(safe-area-inset-bottom),10px)] pt-1.5">
        {TABS.slice(0, 2).map(({ id, label, Icon }) => (
          <NavTab key={id} id={id} label={label} Icon={Icon} screen={screen} go={go} reduce={reduce} />
        ))}

        {/* Scan — the signature action, emphasized but composed */}
        <button
          onClick={() => go("scan")}
          aria-label="Scan ingredients"
          aria-current={screen === "scan" ? "page" : undefined}
          className="group relative -mt-5 flex w-14 shrink-0 flex-col items-center justify-start"
        >
          <motion.span
            whileTap={reduce ? undefined : { scale: 0.92 }}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-flame text-white shadow-cta transition-colors group-hover:bg-flame-deep"
          >
            <ScanLine size={22} strokeWidth={2.2} />
          </motion.span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Scan
          </span>
        </button>

        {TABS.slice(2).map(({ id, label, Icon }) => (
          <NavTab key={id} id={id} label={label} Icon={Icon} screen={screen} go={go} reduce={reduce} />
        ))}
      </div>
    </nav>
  );
}

function NavTab({
  id,
  label,
  Icon,
  screen,
  go,
  reduce,
}: {
  id: string;
  label: string;
  Icon: typeof Home;
  screen: string;
  go: (s: "home" | "discover" | "kitchen" | "profile") => void;
  reduce: boolean | null;
}) {
  const active = screen === id;
  return (
    <button
      onClick={() => go(id as "home" | "discover" | "kitchen" | "profile")}
      aria-current={active ? "page" : undefined}
      className={`relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150 ${
        active ? "text-ink" : "text-muted/75 hover:text-muted"
      }`}
    >
      <Icon size={21} strokeWidth={active ? 2.4 : 1.8} />
      {label}
      {active &&
        (reduce ? (
          <span className="absolute inset-x-[30%] bottom-0.5 h-0.5 rounded-full bg-flame" />
        ) : (
          <motion.span
            layoutId="nav-underline"
            className="absolute inset-x-[30%] bottom-0.5 h-0.5 rounded-full bg-flame"
          />
        ))}
    </button>
  );
}
