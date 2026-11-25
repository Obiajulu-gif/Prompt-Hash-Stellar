import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { verifyImportAttestationHandler } from "../controllers/importAttestationController";
import { createImportAttestation } from "../services/importProvenance";
import { requireAdminScope } from "../middleware/adminAuth";
import { createAdminToken } from "../services/adminToken";

/**
 * Verification endpoint (#1206): request validation, key-not-configured
 * behaviour, and — through the real middleware — that only an admin token
 * carrying `provenance:read` can invoke verification.
 */

const AUDIENCE = "prompt-hash-admin-test";
const SECRET = "verification-secret-at-least-16-chars";
const KEY_ID = "import-v1";
const SIGNER = { keyId: KEY_ID, secret: "attestation-signing-secret-long-enough" };
const RECORDS = [
  { rowRef: "row_a", record: { externalId: "catalog-1", title: "First" } },
  { rowRef: "row_b", record: { externalId: "catalog-2", title: "Second" } },
];

function makeRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(body: any = {}): Request {
  return { body, headers: {}, method: "POST", baseUrl: "/api/provenance", path: "/imports/verify", socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
}

const attestation = createImportAttestation({
  subject: "prev_import_1",
  records: RECORDS,
  signer: SIGNER,
  issuedAt: new Date("2026-03-01T12:00:00Z"),
});

describe("verifyImportAttestationHandler", () => {
  const originalKey = process.env.IMPORT_PROVENANCE_SIGNING_KEY;
  const originalKeyId = process.env.IMPORT_PROVENANCE_KEY_ID;

  beforeEach(() => {
    process.env.IMPORT_PROVENANCE_SIGNING_KEY = SIGNER.secret;
    process.env.IMPORT_PROVENANCE_KEY_ID = KEY_ID;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.IMPORT_PROVENANCE_SIGNING_KEY;
    else process.env.IMPORT_PROVENANCE_SIGNING_KEY = originalKey;
    if (originalKeyId === undefined) delete process.env.IMPORT_PROVENANCE_KEY_ID;
    else process.env.IMPORT_PROVENANCE_KEY_ID = originalKeyId;
  });

  it("returns 200 for an attestation that matches its records", () => {
    const res = makeRes();
    verifyImportAttestationHandler(
      makeReq({ attestation, records: RECORDS, subject: "prev_import_1" }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true, subject: "prev_import_1" }),
    );
  });

  it("returns 422 for a tampered record", () => {
    const res = makeRes();
    verifyImportAttestationHandler(
      makeReq({
        attestation,
        records: [{ ...RECORDS[0], record: { title: "Rewritten" } }, RECORDS[1]],
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ valid: false }),
    );
  });

  it("returns 422 for an unsigned submission rather than assuming validity", () => {
    const res = makeRes();
    verifyImportAttestationHandler(makeReq({ records: RECORDS }), res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reasons: ["unsigned"] }));
  });

  it("returns 400 for a malformed record list", () => {
    const res = makeRes();
    verifyImportAttestationHandler(makeReq({ attestation, records: [{ rowRef: 1 }] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when records is not an array", () => {
    const res = makeRes();
    verifyImportAttestationHandler(makeReq({ attestation }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("fails closed with 503 when this deployment has no signing key", () => {
    delete process.env.IMPORT_PROVENANCE_SIGNING_KEY;
    const res = makeRes();
    verifyImportAttestationHandler(makeReq({ attestation, records: RECORDS }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe("authorization for the verification endpoint", () => {
  const originalAdminSecret = process.env.ADMIN_TOKEN_SECRET;
  const originalAudience = process.env.ADMIN_TOKEN_AUDIENCE;

  beforeEach(() => {
    process.env.ADMIN_TOKEN_SECRET = SECRET;
    process.env.ADMIN_TOKEN_AUDIENCE = AUDIENCE;
  });

  afterEach(() => {
    if (originalAdminSecret === undefined) delete process.env.ADMIN_TOKEN_SECRET;
    else process.env.ADMIN_TOKEN_SECRET = originalAdminSecret;
    if (originalAudience === undefined) delete process.env.ADMIN_TOKEN_AUDIENCE;
    else process.env.ADMIN_TOKEN_AUDIENCE = originalAudience;
  });

  const middleware = requireAdminScope("provenance:read");

  it("admits an admin token with provenance:read", async () => {
    const { token } = createAdminToken(SECRET, {
      sub: "ops-auditor",
      scope: ["provenance:read"],
      iss: "ops-cli",
      aud: AUDIENCE,
    });
    const req = makeReq();
    (req as any).headers = { authorization: `Bearer ${token}` };
    const res = makeRes();
    const next = vi.fn();

    await middleware(req as any, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("denies a token without provenance:read", async () => {
    const { token } = createAdminToken(SECRET, {
      sub: "ops-reports",
      scope: ["reports:read"],
      iss: "ops-cli",
      aud: AUDIENCE,
    });
    const req = makeReq();
    (req as any).headers = { authorization: `Bearer ${token}` };
    const res = makeRes();
    const next = vi.fn();

    await middleware(req as any, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("denies an unauthenticated request", async () => {
    const res = makeRes();
    const next = vi.fn();
    await middleware(makeReq() as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
