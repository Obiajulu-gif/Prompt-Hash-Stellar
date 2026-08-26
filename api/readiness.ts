/**
 * Server Readiness & Deployment Manifest Attestation Endpoint
 *
 * Exposes non-sensitive server deployment identity and configuration readiness.
 */

import { getReadinessAttestation } from "../src/lib/validation/envValidator";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const attestation = getReadinessAttestation();
  const statusCode = attestation.ready ? 200 : 503;

  res.status(statusCode).json(attestation);
}
