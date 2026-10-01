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

import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  return NextResponse.redirect(new URL("/", req.url), 307);
}

export const config = {
  // Deep paths only: `.+` after the leading slash excludes the root `/`
  // (the app itself). api, Next internals and the public assets (service
  // worker MUST resolve unredirected at /sw.js for push scope, plus the
  // manifest and icons) pass through untouched.
  matcher: ["/((?!api|_next|favicon.ico|sw.js|manifest.webmanifest|ruchi-logo).+)"],
};
