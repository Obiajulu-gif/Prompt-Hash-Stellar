/**
 * GET /api/auth/me
 *
 * Returns the Stellar address associated with the current session (JWT).
 * Used by the frontend AuthProvider to rehydrate state after a page reload.
 *
 * Reads the JWT from the HTTP-only "auth_token" cookie (or Authorization
 * Bearer header) and returns the decoded subject (Stellar public key).
 *
 * Returns:
 *   200 { address: string, expiresAt: number }  — valid session
 *   401 { error, code }                         — missing or invalid session
 */

import { withObservability } from "../../src/lib/observability/wrapper";
import { isAuthenticated } from "../../src/lib/auth/middleware";

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  // req.authAddress is set by the isAuthenticated middleware wrapper
  const address: string = req.authAddress;

  // Decode the exp from the token for the client to use for expiry tracking
  const token = req.headers?.cookie
    ?.split(";")
    .find((c: string) => c.trim().startsWith("auth_token="))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();

  let expiresAt: number | undefined;
  if (token) {
    try {
      const { jwtExpiresAtMs } = await import("../../src/lib/auth/jwt");
      expiresAt = jwtExpiresAtMs(token) ?? undefined;
    } catch {
      // Non-critical: just omit expiresAt
    }
  }

  res.status(200).json({ address, expiresAt });
}

export default withObservability(isAuthenticated(handler), "auth/me");
