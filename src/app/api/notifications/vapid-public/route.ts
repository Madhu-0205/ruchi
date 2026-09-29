// ─────────────────────────────────────────────────────────────
// RUCHI — GET /api/notifications/vapid-public
// ─────────────────────────────────────────────────────────────
// Serves the PUBLIC VAPID key for pushManager.subscribe(). The
// private key never leaves server env. When unconfigured the route
// returns 503 so the client treats web push as unavailable (the
// toggle stays a stored preference, nothing breaks).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: "push-not-configured" }, { status: 503 });
  }
  return NextResponse.json(
    { publicKey },
    { headers: { "Cache-Control": "no-store" } },
  );
}
