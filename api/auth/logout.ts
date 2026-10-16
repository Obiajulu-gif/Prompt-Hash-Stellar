/**
 * POST /api/auth/logout
 *
 * Clears the HTTP-only auth_token cookie, terminating the session.
 * The client-side store should clear its in-memory session state upon
 * receiving a 200 from this endpoint.
 */

import { withObservability } from "../../src/lib/observability/wrapper";
import { clearAuthCookie } from "../../src/lib/auth/middleware";

async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  clearAuthCookie(res);
  req.logger?.info("Auth logout: cookie cleared");

  res.status(200).json({ success: true });
}

export default withObservability(handler, "auth/logout");
