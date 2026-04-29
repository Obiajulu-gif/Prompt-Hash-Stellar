import { withObservability } from "../src/lib/observability/wrapper";

const STELLAR_RPC_URL =
  process.env.PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const HORIZON_URL =
  process.env.PUBLIC_STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

type ServiceStatus = "up" | "down" | "degraded";

interface ServiceCheck {
  name: string;
  status: ServiceStatus;
  latencyMs: number | null;
  error?: string;
}

async function pingService(name: string, url: string, timeoutMs = 8000): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    return {
      name,
      status: res.ok ? "up" : "degraded",
      latencyMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    return {
      name,
      status: "down",
      latencyMs: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function pingRpc(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const res = await fetch(STELLAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth", params: [] }),
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { name: "Stellar RPC", status: "degraded", latencyMs, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { result?: { status?: string } };
    const healthy = json?.result?.status === "healthy";
    return {
      name: "Stellar RPC",
      status: healthy ? "up" : "degraded",
      latencyMs,
      ...(healthy ? {} : { error: "RPC reported unhealthy" }),
    };
  } catch (err) {
    return {
      name: "Stellar RPC",
      status: "down",
      latencyMs: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function pingUnlockService(): Promise<ServiceCheck> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(6000),
    });
    const latencyMs = Date.now() - start;
    return {
      name: "Unlock Service",
      status: res.ok ? "up" : "degraded",
      latencyMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    return {
      name: "Unlock Service",
      status: "down",
      latencyMs: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const [rpc, horizon, unlock] = await Promise.all([
    pingRpc(),
    pingService("Horizon", HORIZON_URL),
    pingUnlockService(),
  ]);

  const services: ServiceCheck[] = [rpc, horizon, unlock];
  const overallStatus: ServiceStatus = services.every((s) => s.status === "up")
    ? "up"
    : services.some((s) => s.status === "up")
      ? "degraded"
      : "down";

  res.status(200).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services,
  });
}

export default withObservability(handler, "status");
