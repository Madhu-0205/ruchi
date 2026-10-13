// ─────────────────────────────────────────────────────────────
// RUCHI — account-deletion client helper tests
// ─────────────────────────────────────────────────────────────
// `deleteOwnAccount()` is the browser side of the deletion flow. It must
// forward the CURRENT Supabase session token as a Bearer and never decide
// the target account itself. These tests pin that contract, plus the honest
// degradation the Profile screen renders:
//
//   unconfigured → "Accounts aren't set up in this build yet."
//   network      → "Couldn't reach the account service..."
//   failed       → "Couldn't complete account deletion..."
//
// The server route owner is covered separately by the route tests; here we
// assert only what the client sends and how it maps the response.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("../supabase-auth", () => ({ currentSessionAccessToken: vi.fn() }));

const { getSupabase } = await import("../supabase");
const { currentSessionAccessToken } = await import("../supabase-auth");
const { deleteOwnAccount } = await import("../account");

type SupabaseClientShape = NonNullable<ReturnType<typeof getSupabase>>;

const mockGetSupabase = vi.mocked(getSupabase);
const mockToken = vi.mocked(currentSessionAccessToken);

/** A configured client: the helper only needs it to be non-null. */
const signedInClient = {} as SupabaseClientShape;

describe("deleteOwnAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports 'unconfigured' and never calls fetch when Supabase is absent", async () => {
    mockGetSupabase.mockReturnValue(null);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    await expect(deleteOwnAccount()).resolves.toEqual({
      ok: false,
      reason: "unconfigured",
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("reports 'failed' without a session token (the server would 401 anyway)", async () => {
    mockGetSupabase.mockReturnValue(signedInClient);
    mockToken.mockResolvedValue(null);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    await expect(deleteOwnAccount()).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("POSTs the session Bearer to the route and reports ok on {ok:true}", async () => {
    mockGetSupabase.mockReturnValue(signedInClient);
    mockToken.mockResolvedValue("session-access-token");
    const fetchStub = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    await expect(deleteOwnAccount()).resolves.toEqual({ ok: true });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe("/api/account/delete");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer session-access-token");
    // The client never sends a user id — the server derives it from the token.
    expect(init?.body).toBeUndefined();
  });

  it("reports 'failed' on a non-200 response", async () => {
    mockGetSupabase.mockReturnValue(signedInClient);
    mockToken.mockResolvedValue("tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 500 })),
    );

    await expect(deleteOwnAccount()).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("reports 'failed' when a 200 body does not confirm the deletion", async () => {
    mockGetSupabase.mockReturnValue(signedInClient);
    mockToken.mockResolvedValue("tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );

    await expect(deleteOwnAccount()).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("reports 'network' when the request cannot be sent", async () => {
    mockGetSupabase.mockReturnValue(signedInClient);
    mockToken.mockResolvedValue("tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(deleteOwnAccount()).resolves.toEqual({
      ok: false,
      reason: "network",
    });
  });
});
