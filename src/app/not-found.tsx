// ─────────────────────────────────────────────────────────────
// RUCHI — unknown deep links
// ─────────────────────────────────────────────────────────────
// RUCHI is a single-page application: all product surfaces live behind
// authentication at `/` (the client gate mounts the app only for
// authenticated sessions). Any unknown path lands here and returns to
// the application root — an unauthenticated visitor gets the welcome
// gate, a signed-in user lands in their kitchen. No dead ends.

import { redirect } from "next/navigation";

export default function NotFound() {
  redirect("/");
}
