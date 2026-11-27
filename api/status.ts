import { withObservability } from "../src/lib/observability/wrapper";
import connectDb from "../server/src/db/connectDb";
import { IndexerState } from "../server/src/models/IndexerState";
import {
  runAllProbes,
  calculateOverallHealth,
  type ProbeResult,
  type HealthProbeConfig,
} from "../server/src/services/healthProbes";
import {
  maintenanceBannerService,
  type MaintenanceBannerPublic,
} from "../server/src/services/maintenanceBannerService";
import { derivePublicStatus } from "../server/src/services/publicStatus";
import { readContract } from "../src/lib/stellar/tx";

const STELLAR_RPC_URL =
  process.env.PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const HORIZON_URL =
  process.env.PUBLIC_STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const PAUSE_READ_TIMEOUT_MS = 8000;

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

/**
 * Read the contract's `is_paused` view through a free `simulateTransaction`
 * call (#986). Returns `null` when the contract or simulation account is not
 * configured, or the read fails or times out, so an unknown flag is never
 * reported as paused.
 */
async function readContractPaused(): Promise<boolean | null> {
  const contractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID;
  const simulationAccount = process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT;
  if (!contractId || !simulationAccount) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("is_paused read timeout")), PAUSE_READ_TIMEOUT_MS);
    });
    const paused = await Promise.race([
      readContract<unknown>(
        { rpcUrl: STELLAR_RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, simulationAccount },
        contractId,
        "is_paused",
      ),
      timeout,
    ]);
    return typeof paused === "boolean" ? paused : null;
  } catch (err) {
    console.error("Failed to read contract pause status:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    await connectDb();
    
    // Get indexer state for freshness check
    const indexerState = await IndexerState.findOne({ key: "prompt_hash_contract" });
    const lastIndexedLedger = indexerState?.lastIndexedLedger || 0;

    // Run synthetic health probes in parallel with basic service checks
    const [rpc, horizon, unlock, probeResults, contractPaused] = await Promise.all([
      pingRpc(),
      pingService("Horizon", HORIZON_URL),
      pingUnlockService(),
      runHealthProbes(lastIndexedLedger),
      readContractPaused(),
    ]);

    const services: ServiceCheck[] = [rpc, horizon, unlock];
    
    // Map probe results to service checks
    const probeServices: ServiceCheck[] = probeResults.map((probe) => ({
      name: probe.name,
      status: probe.status === "healthy" ? "up" : probe.status === "degraded" ? "degraded" : "down",
      latencyMs: probe.latencyMs,
      error: probe.error,
    }));

    let maintenance: MaintenanceBannerPublic[] = [];
    try {
      maintenance = await maintenanceBannerService.listActive();
    } catch (err) {
      console.error("Failed to load maintenance banners:", err);
    }

    // Only the sanitized projection is published: raw error text and probe
    // details stay in the server logs (#986).
    const publicStatus = derivePublicStatus({
      components: [...services, ...probeServices],
      probes: probeResults,
      maintenance,
      contractPaused,
      deterministicOrder: true,
    });

    res.status(200).json({
      ...publicStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      indexer: {
        lastIndexedLedger,
        status: indexerState?.leaseHolder ? "active" : "idle",
      },
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      status: "down",
      timestamp: new Date().toISOString(),
      error: "Failed to run status checks",
    });
  }
}

/**
 * Run all synthetic health probes
 */
async function runHealthProbes(lastIndexedLedger: number): Promise<ProbeResult[]> {
  try {
    const config: HealthProbeConfig = {
      rpcUrl: process.env.PUBLIC_STELLAR_RPC_URL || STELLAR_RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      promptHashContractId: process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID || "",
      simulationAccount: process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT || "",
      horizonUrl: HORIZON_URL,
      challengeSecret: process.env.CHALLENGE_TOKEN_SECRET || "",
      unlockPublicKey: process.env.UNLOCK_PUBLIC_KEY || "",
      timeoutMs: 8000,
    };

    // Skip probes if required config is missing
    if (!config.promptHashContractId || !config.simulationAccount || !config.challengeSecret) {
      return [];
    }

    return await runAllProbes(config, lastIndexedLedger);
  } catch (error) {
    console.error("Health probe execution error:", error);
    return [];
  }
}

export default withObservability(handler, "status");
