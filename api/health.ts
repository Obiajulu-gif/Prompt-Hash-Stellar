import { withObservability } from "../src/lib/observability/wrapper";
import { IndexerState } from "../server/src/models/IndexerState";
import connectDb from "../server/src/db/connectDb";
import {
  createHealthMonitor,
  databaseCheck,
  httpStatusFor,
  indexerCheck,
  toPublicHealth,
} from "../server/src/services/publicHealth";

/**
 * Public dependency-aware health (#1179).
 *
 * The serverless `/api/health` endpoint used to answer `"ok"` unconditionally,
 * so uptime monitors and the public status page could not tell a healthy
 * deployment from one whose database was unreachable. It now shares the
 * readiness monitor used by the Express service (#1027):
 *
 *   200 `ok` / `degraded` — the API can serve (degraded may mean stale data)
 *   503 `down`            — a critical dependency is down; `Retry-After: 30`
 *
 * The legacy response fields (`timestamp`, `uptime`, `indexer`) and the
 * `"ok"` status value are preserved, so existing consumers keep working. The
 * added `checkedAt`, `cached` and redacted `dependencies` fields are additive.
 */

export const healthMonitor = createHealthMonitor({
  checks: () => [databaseCheck, indexerCheck()],
  cacheTtlMs: Number(process.env.HEALTH_CACHE_TTL_MS ?? 10_000),
});

interface HealthHandlerDeps {
  connectDb?: () => Promise<unknown>;
  loadIndexerState?: () => Promise<{ lastIndexedLedger?: number } | null>;
  now?: () => number;
}

function uptimeSeconds(): number {
  return typeof process.uptime === "function" ? process.uptime() : 0;
}

export function createHealthHandler(
  monitor: Pick<ReturnType<typeof createHealthMonitor>, "evaluate">,
  deps: HealthHandlerDeps = {},
) {
  const connect = deps.connectDb ?? (() => connectDb());
  const loadIndexerState =
    deps.loadIndexerState ??
    (async () => {
      const state: { lastIndexedLedger?: number } | null = await IndexerState.findOne({
        key: "prompt_hash_contract",
      });
      return state ?? null;
    });
  const now = deps.now ?? Date.now;

  return async function healthHandler(_req: any, res: any) {
    res.setHeader("Cache-Control", "no-store");

    // Connecting first lets `databaseCheck` observe the live readyState. A
    // failed connection is itself the dependency failure the report describes,
    // so it must not abort the response.
    let state: { lastIndexedLedger?: number } | null = null;
    try {
      await connect();
      state = await loadIndexerState();
    } catch {
      state = null;
    }

    const legacy = {
      timestamp: new Date(now()).toISOString(),
      uptime: uptimeSeconds(),
      indexer: { lastProcessedLedger: state?.lastIndexedLedger ?? 0 },
    };

    try {
      const { report, cached } = await monitor.evaluate();
      const status = httpStatusFor(report.status);
      if (status === 503) res.setHeader("Retry-After", "30");
      res.status(status).json({ ...toPublicHealth(report, cached), ...legacy });
    } catch {
      // A crash inside the monitor is an outage, not a 500: the endpoint must
      // remain usable by load balancers.
      res.setHeader("Retry-After", "30");
      res.status(503).json({
        status: "down",
        checkedAt: new Date(now()).toISOString(),
        cached: false,
        dependencies: [],
        ...legacy,
      });
    }
  };
}

export default withObservability(createHealthHandler(healthMonitor), "health");
