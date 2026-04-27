import { withObservability, type ApiRequest, type ApiResponse } from "../src/lib/observability/wrapper";

/**
 * Health check handler with explicit typing to satisfy strict CI rules.
 * Prefixed _req with an underscore to satisfy the 'unused-variable' check.
 */
async function handler(_req: ApiRequest, res: ApiResponse) {
  const status = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV,
    version: process.env.npm_package_version || "0.1.0",
  };

  // Explicit status and json calls are now safe because 'res' is typed
  return res.status(200).json(status);
}

export default withObservability(handler, "health");