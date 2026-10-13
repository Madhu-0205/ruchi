// ─────────────────────────────────────────────────────────────
// RUCHI — edge middleware: single-application route posture
// ─────────────────────────────────────────────────────────────
// RUCHI is a single-page application: the product lives at `/` behind
// the authentication gate. Any manually entered deep path gets a hard
// HTTP 307 back to `/`, where the server-rendered shell decides —
// unauthenticated visitors see only the welcome experience, signed-in
// users land in their kitchen. No protected content is ever served at
// a deep path, and the redirect works even for non-browser clients.
//
// API routes and static assets pass through untouched.
//
// `/privacy` is the one exempt deep path. It is a public policy document,
// not part of the application shell: app stores require a privacy-policy
// URL that loads for an anonymous visitor, so it must never be bounced to
// the sign-in gate. `/privacy` is server-rendered and contains no user
// data, so serving it publicly leaks nothing.

import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  return NextResponse.redirect(new URL("/", req.url), 307);
}

export const config = {
  // Deep paths only: `.+` after the leading slash excludes the root `/`
  // (the app itself). api, Next internals, the public assets (service
  // worker MUST resolve unredirected at /sw.js for push scope, plus the
  // manifest and icons) and the public privacy policy pass through.
  matcher: [
    "/((?!api|_next|favicon.ico|sw.js|manifest.webmanifest|ruchi-logo|privacy).+)",
  ],
};
