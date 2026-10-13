// ─────────────────────────────────────────────────────────────
// POST /api/account/delete — route contract tests
// ─────────────────────────────────────────────────────────────
// These pin the security posture of the account-deletion endpoint, which is
// the only irreversible action in RUCHI:
//
//   1. No verified session  → 401, and Supabase is never asked to delete.
//   2. Verified session but no service-role credential → 503.
//   3. Verified session + admin API success → 200, and the admin API is
//      called with the id from the SESSION (never from the request body).
//   4. Admin API failure → non-200 with a generic, non-enumerating message.
//   5. "already gone" outcomes count as success: the account is gone.
//
// REGRESSION (found by a live end-to-end run, 2026-10-13): the route used to
// build its own `GoTrueAdminApi` from `@supabase/auth-js` and never look at
// the returned `error`. `auth-js` admin methods RETURN `{data,error}` for API
// failures instead of throwing, so a deletion that failed (Supabase's gateway
// rejected the call for a missing `apikey` header) was reported to the user
// as `{ok:true}` while the account survived. The tests below fail on that
// behavior: a returned error must never produce a 200.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/api-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api-auth")>();
  return {
    ...actual,
    authenticateRequest: vi.fn(),
    createServiceRoleClient: vi.fn(),
  };
});

// The error the auth admin API "returns". `null` means the deletion worked.
// Returned rather than thrown on purpose: that is exactly how auth-js
// reports API-level failures.
let adminApiError: { message: string; status?: number; code?: string } | null = null;
let adminApiThrows = false;

const deleteUser = vi.fn(async (_userId: string) => {
  if (adminApiThrows) throw new TypeError("fetch failed");
  return { data: { user: null }, error: adminApiError };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { deleteUser } } }),
}));

const { authenticateRequest, createServiceRoleClient } = await import(
  "@/lib/auth/api-auth"
);
const { POST, GET } = await import("@/app/api/account/delete/route");

const mockAuth = vi.mocked(authenticateRequest);
const mockServiceRole = vi.mocked(createServiceRoleClient);

const BASE = "https://ruchi.test/api/account/delete";

const makeReq = (headers?: Record<string, string>, body?: unknown): Request =>
  new Request(BASE, {
    method: "POST",
    headers: new Headers(headers ?? {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const authed = (id: string) => mockAuth.mockResolvedValue({ ok: true, user: { id } });

const GENERIC_ERROR =
  "Couldn't complete account deletion. Please try again in a moment.";

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApiError = null;
    adminApiThrows = false;
    mockServiceRole.mockReturnValue({
      auth: { admin: { deleteUser } },
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no verified session → 401 and no admin deletion is attempted", async () => {
    mockAuth.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST(makeReq());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Sign in to continue." });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("verified session but no service-role client → 503, and nothing is deleted", async () => {
    authed("user-1");
    mockServiceRole.mockReturnValue(null);

    const res = await POST(makeReq({ Authorization: "Bearer token" }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: GENERIC_ERROR });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("verified session + admin success → 200 and deletes the SESSION id", async () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    authed(userId);

    const res = await POST(makeReq({ Authorization: "Bearer token" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    // Ownership is derived from the verified session, not the request body.
    expect(deleteUser).toHaveBeenCalledWith(userId);
  });

  it("ignores any client-supplied user id in the body", async () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    authed(userId);

    const res = await POST(
      makeReq({ Authorization: "Bearer token" }, {
        userId: "99999999-9999-9999-9999-999999999999",
        user_id: "99999999-9999-9999-9999-999999999999",
      }),
    );

    expect(res.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(userId);
    expect(deleteUser).not.toHaveBeenCalledWith("99999999-9999-9999-9999-999999999999");
  });

  // ── The regression that a live run caught ──────────────────
  it("REGRESSION: a returned admin error must never be reported as success", async () => {
    authed("11111111-2222-3333-4444-555555555555");
    // Exactly the shape the live failure produced: gateway 401, message
    // about the missing API key, delivered as `error` not as a throw.
    adminApiError = {
      message: "No API key found in request",
      status: 401,
      code: "401",
    };

    const res = await POST(makeReq({ Authorization: "Bearer token" }));

    expect(res.status).not.toBe(200);
    await expect(res.json()).resolves.toEqual({ error: GENERIC_ERROR });
  });

  it("admin failure → 502 with a generic, non-provider message", async () => {
    authed("11111111-2222-3333-4444-555555555555");
    adminApiError = {
      message: "duplicate key value violates unique constraint pg_1",
      status: 500,
    };

    const res = await POST(makeReq({ Authorization: "Bearer token" }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR });
    // No provider detail leaks to the client.
    expect(JSON.stringify(body)).not.toContain("constraint");
  });

  it("rate limiting → 429 with the same generic message", async () => {
    authed("11111111-2222-3333-4444-555555555555");
    adminApiError = { message: "Too many requests", status: 429 };

    const res = await POST(makeReq({ Authorization: "Bearer token" }));

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: GENERIC_ERROR });
  });

  it("transport failure → 504 (auth-js throws only for transport errors)", async () => {
    authed("11111111-2222-3333-4444-555555555555");
    adminApiThrows = true;

    const res = await POST(makeReq({ Authorization: "Bearer token" }));

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toEqual({ error: GENERIC_ERROR });
  });

  it("admin 'already gone' → 200 (the account is gone either way)", async () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    authed(userId);
    adminApiError = { message: "User not found", status: 404, code: "user_not_found" };

    const res = await POST(makeReq({ Authorization: "Bearer token" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith(userId);
  });

  it("GET is not a deletion path → 405", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
