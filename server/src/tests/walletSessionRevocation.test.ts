/**
 * Stale session and token revocation on the wallet-session middleware (#1133).
 *
 * Exercises requireWalletSession / hasFreshWalletSession against the real
 * global revocation registry, covering:
 *   - normal:        valid session admitted for its own wallet
 *   - failure:       missing, malformed, foreign, expired, or wrong-action tokens
 *   - retry:         a session issued after a security event signs in again
 *   - authorization: revoked subjects refused with a user-safe message; false-
 *                    alarm reinstatement restores access; only authorized actors
 *                    may reinstate
 *
 * Every case uses its own wallet because revocations live in a process-wide
 * registry. Times are passed explicitly so the cutoff ordering is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { createChallengeToken } from "../../../src/lib/auth/challenge";
import {
  hasFreshWalletSession,
  requireWalletSession,
  type WalletSessionRequest,
  WALLET_SESSION_TTL_MS,
} from "../middleware/walletSession";
import {
  globalSessionRevocationRegistry,
  invalidateSessionsForSecurityEvent,
  type RevocationActor,
} from "../services/sessionRevocationService";

// Checksum-valid Stellar public keys (56 chars), one per case.
const WALLET_NORMAL = "GAHR4LJ4JNNGS6EHS2S3JQ6S4HYA6HRNHRFVU2LYQ6LKLNGD2LQ7B6UB";
const WALLET_FOREIGN = "GANCWPCNLZXXBAMSUO2MLVXH7AERUKZ4JVPG64EBSKR3JROW474ASQB5";
const WALLET_REVOKED = "GAVTYTK6N5YIDEVDWTC5NZ7YBENCWPCNLZXXBAMSUO2MLVXH7AERUY35";
const WALLET_RECOVERY = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXP";
const WALLET_FRESH = "GB6LWP5M4ACCF3B5UKQ4TVM7ZGWB2XHZ3PNOTTB5WSC3PW2HBHC62PZN";
const WALLET_STALE = "GAGJKVUYNKLLUAYZPFT5IIZSGXHD2NG6NRGFQJZHCMOI5OUAD6MWMRK3";

const SECRET = "wallet-session-revocation-test-secret";
const ADMIN: RevocationActor = {
  id: "ops-sec-lead",
  role: "admin",
  permissions: new Set(["admin", "security:revoke"]),
};
const VIEWER: RevocationActor = {
  id: "guest-user",
  role: "viewer",
  permissions: new Set(["prompts:read"]),
};

function sessionToken(wallet: string, issuedAt = Date.now(), ttlMs = WALLET_SESSION_TTL_MS): string {
  return createChallengeToken(SECRET, wallet, "wallet-session", issuedAt, ttlMs, {
    action: "wallet_session",
  }).token;
}

function makeResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

function makeRequest(wallet: string, token?: string): WalletSessionRequest {
  return {
    method: "GET",
    path: `/api/wallet-session/${wallet}/library`,
    params: { wallet },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as WalletSessionRequest;
}

/** Runs the guard for `wallet` and reports whether the protected handler was reached. */
function guard(req: WalletSessionRequest) {
  const res = makeResponse();
  const next = vi.fn();
  requireWalletSession((r) => (r as unknown as { params: { wallet: string } }).params.wallet)(
    req,
    res as unknown as Response,
    next,
  );
  return { res, next };
}

describe("wallet session guard — normal path (#1133)", () => {
  beforeEach(() => {
    process.env.CHALLENGE_TOKEN_SECRET = SECRET;
  });

  it("admits a valid session for its own wallet and records the wallet on the request", () => {
    const req = makeRequest(WALLET_NORMAL, sessionToken(WALLET_NORMAL));
    const { res, next } = guard(req);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.sessionWallet).toBe(WALLET_NORMAL);
  });

  it("accepts a lower-cased wallet parameter and normalizes it to the account form", () => {
    const req = makeRequest(WALLET_NORMAL.toLowerCase(), sessionToken(WALLET_NORMAL));
    req.params = { wallet: WALLET_NORMAL.toLowerCase() };
    const { next } = guard(req);
    expect(next).toHaveBeenCalledOnce();
    expect(req.sessionWallet).toBe(WALLET_NORMAL);
  });
});

describe("wallet session guard — failure paths (#1133)", () => {
  beforeEach(() => {
    process.env.CHALLENGE_TOKEN_SECRET = SECRET;
  });

  it("returns 401 when no bearer token is presented", () => {
    const { res, next } = guard(makeRequest(WALLET_FOREIGN));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed wallet address before checking the token", () => {
    const req = makeRequest("not-a-wallet", sessionToken(WALLET_NORMAL));
    req.params = { wallet: "not-a-wallet" };
    const { res, next } = guard(req);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a session that was issued to a different wallet", () => {
    const { res, next } = guard(makeRequest(WALLET_FOREIGN, sessionToken(WALLET_NORMAL)));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses an expired session", () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const { res, next } = guard(
      makeRequest(WALLET_FOREIGN, sessionToken(WALLET_FOREIGN, twoHoursAgo, WALLET_SESSION_TTL_MS)),
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses an unlock challenge replayed as a session (action mismatch)", () => {
    const unlockToken = createChallengeToken(SECRET, WALLET_FOREIGN, "wallet-session", Date.now(), 60_000, {
      action: "unlock",
    }).token;
    const { res, next } = guard(makeRequest(WALLET_FOREIGN, unlockToken));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 without leaking details when the session secret is not configured", () => {
    delete process.env.CHALLENGE_TOKEN_SECRET;
    try {
      const { res, next } = guard(makeRequest(WALLET_FOREIGN, sessionToken(WALLET_FOREIGN)));
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    } finally {
      process.env.CHALLENGE_TOKEN_SECRET = SECRET;
    }
  });
});

describe("wallet session guard — revocation and recovery (#1133)", () => {
  beforeEach(() => {
    process.env.CHALLENGE_TOKEN_SECRET = SECRET;
  });

  afterEach(() => {
    // Keep the shared registry clean for the next case.
    globalSessionRevocationRegistry.reinstateSubject(WALLET_REVOKED, ADMIN, "test cleanup");
    globalSessionRevocationRegistry.reinstateSubject(WALLET_RECOVERY, ADMIN, "test cleanup");
  });

  it("refuses a session issued before a subject security event with a user-safe message", () => {
    const eventAt = Date.now() - 10_000;
    const preEventToken = sessionToken(WALLET_REVOKED, eventAt - 5_000);
    invalidateSessionsForSecurityEvent(
      globalSessionRevocationRegistry,
      {
        type: "wallet_compromise",
        subject: WALLET_REVOKED,
        reason: "internal-ticket-SEC-42: key leaked in paste",
        actor: ADMIN,
      },
      eventAt,
    );

    const { res, next } = guard(makeRequest(WALLET_REVOKED, preEventToken));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    const body = res.body as { code: string; error: string };
    expect(body.code).toBe("subject_revoked_by_security_event");
    // The internal reason must never reach the client.
    expect(JSON.stringify(body)).not.toContain("SEC-42");
  });

  it("admits a new session signed in after the event (retry path)", () => {
    const eventAt = Date.now() - 10_000;
    invalidateSessionsForSecurityEvent(
      globalSessionRevocationRegistry,
      { type: "wallet_compromise", subject: WALLET_RECOVERY, reason: "suspected leak", actor: ADMIN },
      eventAt,
    );

    const freshToken = sessionToken(WALLET_RECOVERY, Date.now());
    const { next } = guard(makeRequest(WALLET_RECOVERY, freshToken));
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves other accounts' sessions usable after one wallet is revoked", () => {
    const eventAt = Date.now() - 10_000;
    invalidateSessionsForSecurityEvent(
      globalSessionRevocationRegistry,
      { type: "wallet_compromise", subject: WALLET_REVOKED, reason: "suspected leak", actor: ADMIN },
      eventAt,
    );

    const { next } = guard(makeRequest(WALLET_FOREIGN, sessionToken(WALLET_FOREIGN, eventAt - 5_000)));
    expect(next).toHaveBeenCalledOnce();
  });

  it("restores a pre-event session after an authorized false-alarm reinstatement (rollback)", () => {
    const eventAt = Date.now() - 10_000;
    const preEventToken = sessionToken(WALLET_RECOVERY, eventAt - 5_000);
    invalidateSessionsForSecurityEvent(
      globalSessionRevocationRegistry,
      { type: "suspicious_activity", subject: WALLET_RECOVERY, reason: "alert later found benign", actor: ADMIN },
      eventAt,
    );
    expect(guard(makeRequest(WALLET_RECOVERY, preEventToken)).next).not.toHaveBeenCalled();

    expect(globalSessionRevocationRegistry.reinstateSubject(WALLET_RECOVERY, ADMIN, "false positive")).toBe(true);
    expect(guard(makeRequest(WALLET_RECOVERY, preEventToken)).next).toHaveBeenCalledOnce();
  });

  it("does not let an unauthorized actor reinstate a revoked subject", () => {
    const eventAt = Date.now() - 10_000;
    invalidateSessionsForSecurityEvent(
      globalSessionRevocationRegistry,
      { type: "wallet_compromise", subject: WALLET_REVOKED, reason: "suspected leak", actor: ADMIN },
      eventAt,
    );

    expect(() => globalSessionRevocationRegistry.reinstateSubject(WALLET_REVOKED, VIEWER, "try")).toThrow(/unauthorized/i);
    const { next } = guard(makeRequest(WALLET_REVOKED, sessionToken(WALLET_REVOKED, eventAt - 5_000)));
    expect(next).not.toHaveBeenCalled();
  });
});

describe("hasFreshWalletSession — step-up authorization (#1133)", () => {
  beforeEach(() => {
    process.env.CHALLENGE_TOKEN_SECRET = SECRET;
  });

  it("accepts a session signed within the step-up window", () => {
    const req = makeRequest(WALLET_FRESH, sessionToken(WALLET_FRESH, Date.now() - 60_000));
    expect(hasFreshWalletSession(req, WALLET_FRESH, 5 * 60 * 1000)).toBe(true);
  });

  it("rejects an otherwise valid session that is older than the step-up window", () => {
    const req = makeRequest(WALLET_STALE, sessionToken(WALLET_STALE, Date.now() - 10 * 60 * 1000));
    expect(hasFreshWalletSession(req, WALLET_STALE, 5 * 60 * 1000)).toBe(false);
  });

  it("rejects a request without a bearer token", () => {
    expect(hasFreshWalletSession(makeRequest(WALLET_FRESH), WALLET_FRESH)).toBe(false);
  });
});
