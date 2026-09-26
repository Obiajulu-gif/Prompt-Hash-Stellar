import { describe, expect, it, beforeEach } from "vitest";
import {
  AdminTokenError,
  createAdminToken,
  isAdminTokenRevoked,
  revokeAdminToken,
  verifyAdminToken,
  __clearRevokedAdminTokensForTests,
} from "../services/adminToken";

const SECRET = "unit-test-admin-secret";
const OTHER_SECRET = "a-completely-different-secret";
const AUDIENCE = "prompt-hash-admin-test";
const ISSUED_AT = 1_700_000_000_000;

function mint(scope: string[], ttlMs = 60_000, secret = SECRET) {
  return createAdminToken(
    secret,
    { sub: "ops-jane", scope, iss: "ops-cli", aud: AUDIENCE, ttlMs },
    ISSUED_AT,
  );
}

beforeEach(() => {
  __clearRevokedAdminTokensForTests();
});

describe("admin token verification (#542)", () => {
  it("accepts a well-formed token carrying the required scope", () => {
    const { token } = mint(["integrity:read", "reports:read"]);
    const payload = verifyAdminToken(
      SECRET,
      token,
      { audience: AUDIENCE, requiredScope: "integrity:read" },
      ISSUED_AT + 1_000,
    );
    expect(payload.sub).toBe("ops-jane");
    expect(payload.role).toBe("admin");
    expect(payload.scope).toContain("integrity:read");
  });

  it("rejects a token missing the required scope", () => {
    const { token } = mint(["reports:read"]);
    expect(() =>
      verifyAdminToken(
        SECRET,
        token,
        { audience: AUDIENCE, requiredScope: "integrity:write" },
        ISSUED_AT + 1_000,
      ),
    ).toThrowError(AdminTokenError);

    try {
      verifyAdminToken(
        SECRET,
        token,
        { audience: AUDIENCE, requiredScope: "integrity:write" },
        ISSUED_AT + 1_000,
      );
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("insufficient_scope");
    }
  });

  it("rejects an expired token", () => {
    const { token } = mint(["integrity:read"], 5_000);
    try {
      verifyAdminToken(
        SECRET,
        token,
        { audience: AUDIENCE, requiredScope: "integrity:read" },
        ISSUED_AT + 5_001,
      );
      throw new Error("expected verification to throw");
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("expired");
    }
  });

  it("rejects a token minted for a different environment (audience)", () => {
    const { token } = mint(["integrity:read"]);
    try {
      verifyAdminToken(
        SECRET,
        token,
        { audience: "some-other-environment", requiredScope: "integrity:read" },
        ISSUED_AT + 1_000,
      );
      throw new Error("expected verification to throw");
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("wrong_audience");
    }
  });

  it("rejects a token signed with a secret that isn't active", () => {
    const { token } = mint(["integrity:read"], 60_000, OTHER_SECRET);
    try {
      verifyAdminToken(
        SECRET,
        token,
        { audience: AUDIENCE, requiredScope: "integrity:read" },
        ISSUED_AT + 1_000,
      );
      throw new Error("expected verification to throw");
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("invalid_signature");
    }
  });

  it("rejects a tampered payload even if the signature segment is untouched", () => {
    const { token } = mint(["integrity:read"]);
    const [encodedPayload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    decoded.scope = ["integrity:read", "integrity:write"];
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    const tamperedToken = `${tamperedPayload}.${signature}`;

    try {
      verifyAdminToken(
        SECRET,
        tamperedToken,
        { audience: AUDIENCE, requiredScope: "integrity:write" },
        ISSUED_AT + 1_000,
      );
      throw new Error("expected verification to throw");
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("invalid_signature");
    }
  });

  it("accepts a token signed with the previous secret during rotation, then rejects it once retired", () => {
    const { token } = mint(["integrity:read"], 60_000, "the-previous-secret");

    // Grace period: both the new and the previous secret are active.
    const payload = verifyAdminToken(
      ["the-new-secret", "the-previous-secret"],
      token,
      { audience: AUDIENCE, requiredScope: "integrity:read" },
      ISSUED_AT + 1_000,
    );
    expect(payload.sub).toBe("ops-jane");

    // After the previous secret is retired, the same token is rejected.
    try {
      verifyAdminToken(
        ["the-new-secret"],
        token,
        { audience: AUDIENCE, requiredScope: "integrity:read" },
        ISSUED_AT + 1_000,
      );
      throw new Error("expected verification to throw");
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("invalid_signature");
    }
  });

  it("rejects a revoked token immediately, even though it has not expired", () => {
    const { token, payload } = mint(["integrity:write"]);

    verifyAdminToken(
      SECRET,
      token,
      { audience: AUDIENCE, requiredScope: "integrity:write" },
      ISSUED_AT + 1_000,
    );

    revokeAdminToken(payload.nonce);
    expect(isAdminTokenRevoked(payload.nonce)).toBe(true);

    try {
      verifyAdminToken(
        SECRET,
        token,
        { audience: AUDIENCE, requiredScope: "integrity:write" },
        ISSUED_AT + 2_000,
      );
      throw new Error("expected verification to throw");
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("revoked");
    }
  });

  it("rejects a malformed token", () => {
    try {
      verifyAdminToken(
        SECRET,
        "not-a-real-token",
        { audience: AUDIENCE, requiredScope: "integrity:read" },
        ISSUED_AT,
      );
      throw new Error("expected verification to throw");
    } catch (err) {
      expect((err as AdminTokenError).code).toBe("malformed");
    }
  });
});
