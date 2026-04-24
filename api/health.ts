import { withObservability } from "../src/lib/observability/wrapper";

async function handler(req: any, res: any) {
  // Basic health check
  const status = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV,
    version: process.env.npm_package_version || "0.1.0",
  };

  // Here we could add checks for downstream services (Stellar RPC, etc.)
  
  res.status(200).json(status);
}

export default withObservability(handler, "health");
