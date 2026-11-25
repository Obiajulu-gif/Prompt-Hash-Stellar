import { Request, Response } from "express";
import {
  loadImportProvenanceKeyRing,
  verifyImportAttestation,
  type AttestedImportRecord,
  type ImportAttestation,
} from "../services/importProvenance";

/**
 * Admin-only attestation verifier (#1206).
 *
 * Import receipts are issued to the operator and stored wherever they keep
 * their audit trail; this endpoint lets a reviewer re-verify a stored receipt
 * without holding the signing secret. It is read-only, consumes no database
 * state, and is mounted behind `requireAdminScope("provenance:read")`.
 *
 * Responses:
 *   200 — attestation verifies against the supplied records
 *   400 — malformed body (not an attestation/record list)
 *   422 — well-formed but invalid (tampered, unknown key, chain break, ...)
 *   503 — this deployment has no import signing key configured
 */
export function verifyImportAttestationHandler(
  req: Request,
  res: Response,
): Response {
  const body = req.body ?? {};
  const { attestation, records } = body as {
    attestation?: ImportAttestation | null;
    records?: AttestedImportRecord[];
  };

  if (!Array.isArray(records)) {
    return res.status(400).json({
      error: "Invalid request",
      message: "records must be an array of { rowRef, record } entries",
    });
  }

  for (const record of records) {
    if (
      !record ||
      typeof record.rowRef !== "string" ||
      !record.rowRef ||
      !record.record ||
      typeof record.record !== "object" ||
      Array.isArray(record.record)
    ) {
      return res.status(400).json({
        error: "Invalid request",
        message: "every record must be { rowRef: string, record: object }",
      });
    }
  }

  if (attestation !== undefined && attestation !== null) {
    if (
      typeof attestation !== "object" ||
      typeof attestation.keyId !== "string" ||
      !Array.isArray(attestation.entries)
    ) {
      return res.status(400).json({
        error: "Invalid request",
        message: "attestation must be an ImportAttestation envelope",
      });
    }
  }

  const keyRing = loadImportProvenanceKeyRing();
  if (!keyRing.configured) {
    return res.status(503).json({
      error: "Verification unavailable",
      message:
        "Import provenance signing is not configured on this deployment (IMPORT_PROVENANCE_SIGNING_KEY).",
    });
  }

  const expectedSubject =
    typeof body.subject === "string" && body.subject ? body.subject : undefined;

  const verification = verifyImportAttestation({
    attestation: attestation ?? null,
    records,
    resolveKey: keyRing.resolveKey,
    expectedSubject,
  });

  return res.status(verification.valid ? 200 : 422).json(verification);
}
