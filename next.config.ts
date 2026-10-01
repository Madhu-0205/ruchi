import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────
// RUCHI — production configuration
// ─────────────────────────────────────────────────────────────
// Security headers applied to every route. CSP: Next.js needs inline
// scripts for hydration and inline styles for its styling pipeline, so
// those are allowed narrowly; Supabase is the only backend origin.
// Frames are fully denied; sniffing and referrer leakage are closed;
// HSTS asserts HTTPS for a year.
// ─────────────────────────────────────────────────────────────

const CSP = [
  "default-src 'self'",
  // Next.js hydration blobs are nonce-able only with middleware; 'unsafe-inline'
  // scripts on a static SPA shell is the accepted production posture here.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "font-src 'self' data:",
  // Supabase is the only backend the browser talks to.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Upgrade is asserted by HSTS; keep mixed content blocked hard.
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Single-page consumer app; client store persists to localStorage.
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
