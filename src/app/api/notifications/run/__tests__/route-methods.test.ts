// Cron method-compatibility regression tests (Vercel Cron → GET).
//
// Vercel Cron invokes cron endpoints via HTTP GET, but this route exported
// POST only — every scheduled run 405'd before the shared-handler fix. These
// tests pin the contract: GET and POST are the SAME handler with the SAME
// CRON_SECRET gate and the SAME error responses, so the fix can never drift
// back into a method mismatch or a weakened auth posture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/notifications/run/route";

const BASE = "http://localhost/api/notifications/run";

// The route reads env at request time; tests pin a known secret and strip
// the service-role key so the handler deterministically stops at the
// "service-unconfigured" gate — past auth, before any Supabase I/O.
const REAL_SECRET = process.env.CRON_SECRET;
const REAL_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = "test-cron-secret";

beforeEach(() => {
  // Defensive: even if a service key ever leaked into the test env, no
  // request may leave the process.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network disabled in cron route tests");
  }));
  process.env.CRON_SECRET = SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (REAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = REAL_SECRET;
  if (REAL_SERVICE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = REAL_SERVICE_KEY;
});

describe("cron route method compatibility", () => {
  it("GET and POST are the exact same handler", () => {
    expect(GET).toBe(POST);
    expect(typeof GET).toBe("function");
  });

  it("unconfigured CRON_SECRET → 503 cron-not-configured on BOTH methods", async () => {
    delete process.env.CRON_SECRET;
    for (const [name, handler] of [["GET", GET], ["POST", POST]] as const) {
      const res = await handler(new Request(BASE, { method: name }));
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ error: "cron-not-configured" });
    }
  });

  it("unauthenticated GET → 401 (never 405)", async () => {
    const res = await GET(new Request(BASE, { method: "GET" }));
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(405);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("GET with a wrong Bearer → 401 (the CRON_SECRET gate applies to GET)", async () => {
    const res = await GET(
      new Request(BASE, {
        method: "GET",
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("authenticated GET reaches the SAME handler body (next gate: service-unconfigured)", async () => {
    const res = await GET(
      new Request(BASE, {
        method: "GET",
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
    );
    // Past the auth layer, the handler's next gate fires deterministically
    // without Supabase — proving GET executes the real POST implementation.
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "service-unconfigured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POST behavior is unchanged: 401 without credentials, 401 on wrong Bearer", async () => {
    const noAuth = await POST(new Request(BASE, { method: "POST" }));
    expect(noAuth.status).toBe(401);
    await expect(noAuth.json()).resolves.toEqual({ error: "unauthorized" });

    const wrongAuth = await POST(
      new Request(BASE, {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    );
    expect(wrongAuth.status).toBe(401);
    await expect(wrongAuth.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("authenticated POST behaves identically to authenticated GET", async () => {
    const res = await POST(
      new Request(BASE, {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "service-unconfigured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("methods are interchangeable: same request shape → same status via GET and POST", async () => {
    const make = (method: string) =>
      new Request(BASE, {
        method,
        headers: { Authorization: "Bearer also-wrong" },
      });
    const viaGet = await GET(make("GET"));
    const viaPost = await POST(make("POST"));
    expect(viaGet.status).toBe(viaPost.status);
    expect(await viaGet.json()).toEqual(await viaPost.json());
  });
});
