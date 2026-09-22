"use client";

// ─────────────────────────────────────────────────────────────
// RUCHI — official icon-only logo component
// ─────────────────────────────────────────────────────────────
// Single canonical asset: /ruchi-logo.svg (public/). Never inline a copy
// of the artwork anywhere else — render this component instead. The
// standalone icon IS the app mark: no wordmark, no tagline, no badges,
// no borders or shadows beyond the rounded tile in the artwork itself.

import Image from "next/image";

export function RuchiLogo({
  size = 48,
  priority = false,
  className = "",
}: {
  /** Rendered edge in px. Aspect ratio is fixed by the artwork (1:1). */
  size?: number;
  /** Set on the highest-LCP instance (Home hero) to skip lazy injection. */
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/ruchi-logo.svg"
      alt="RUCHI"
      width={size}
      height={size}
      priority={priority}
      className={`shrink-0 ${className}`}
    />
  );
}
