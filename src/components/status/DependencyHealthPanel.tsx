import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ServerCrash,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DEPENDENCY_STATUS_COPY,
  OVERALL_HEALTH_COPY,
  formatRetryDelay,
  hasCriticalOutage,
  normalizeDependencyHealth,
  retryAfterDelayMs,
  type DependencyHealthView,
  type DependencyStatus,
  type OverallHealth,
} from "@/lib/health/dependencyHealth";

/** Never auto-retry faster than once a second, even for `Retry-After: 0`. */
const AUTO_RETRY_FLOOR_MS = 1_000;

const STATUS_BADGE: Record<DependencyStatus, string> = {
  up: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  degraded: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  down: "border-rose-300/30 bg-rose-300/10 text-rose-100",
};

const OVERALL_BADGE: Record<OverallHealth, string> = {
  ok: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  degraded: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  down: "border-rose-300/30 bg-rose-300/10 text-rose-100",
};

function OverallIcon({ status }: { status: OverallHealth }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  if (status === "degraded") return <AlertTriangle className="h-5 w-5 text-amber-400" />;
  return <ServerCrash className="h-5 w-5 text-rose-400" />;
}

function DependencyIcon({ status }: { status: DependencyStatus }) {
  if (status === "up") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "degraded") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  return <XCircle className="h-4 w-4 text-rose-400" />;
}

export interface DependencyHealthPanelProps {
  /** Public readiness endpoint. Kept overridable for tests. */
  endpoint?: string;
  /** Bounded retry delay used when the response has no usable Retry-After. */
  fallbackRetryMs?: number;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Public dependency-aware readiness view (#1179).
 *
 * Reads the already-published `GET /api/health` contract and renders one row
 * per dependency. It never sends credentials (the endpoint is public), never
 * renders raw server detail, and backs off with `Retry-After` when the
 * endpoint reports an outage or is unreachable.
 */
export function DependencyHealthPanel({
  endpoint = "/api/health",
  fallbackRetryMs,
  fetchImpl,
}: DependencyHealthPanelProps) {
  const [view, setView] = useState<DependencyHealthView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryInMs, setRetryInMs] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);

  const request = useCallback(
    async (signal: AbortSignal) => {
      const doFetch = fetchImpl ?? fetch;
      setLoading(true);
      setError(null);
      try {
        const response = await doFetch(endpoint, {
          method: "GET",
          // The endpoint is unauthenticated; never attach cookies or tokens.
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal,
        });

        const payload = await response.json().catch(() => null);
        if (signal.aborted) return;

        const next = normalizeDependencyHealth(payload, response.status);
        setView(next);

        const needsBackoff = response.status === 503 || hasCriticalOutage(next);
        const retryHeader = response.headers?.get?.("retry-after");
        const delay = retryAfterDelayMs(retryHeader, Date.now());
        setRetryInMs(needsBackoff ? (fallbackRetryMs ?? delay) : null);
      } catch (err) {
        if (signal.aborted) return;
        setView(null);
        setError(err instanceof Error ? err.message : "Dependency health is unavailable");
        setRetryInMs(fallbackRetryMs ?? retryAfterDelayMs(null, Date.now()));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [endpoint, fallbackRetryMs, fetchImpl],
  );

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void request(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [attempt, request]);

  // Automatic retry after the server-directed delay, so an outage does not
  // leave a stale panel on screen and does not turn into a polling storm.
  useEffect(() => {
    if (retryInMs === null) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) setAttempt((value) => value + 1);
    }, Math.max(AUTO_RETRY_FLOOR_MS, retryInMs));
    return () => clearTimeout(timer);
  }, [retryInMs]);

  const refresh = () => {
    setRetryInMs(null);
    setAttempt((value) => value + 1);
  };

  return (
    <section className="mt-8 space-y-3" aria-labelledby="dependency-health-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="dependency-health-heading"
          className="text-xs uppercase tracking-[0.2em] text-slate-500"
        >
          Dependencies
        </h2>
        <Badge className="border-cyan-300/30 bg-cyan-300/10 text-cyan-100 text-[10px]">
          Readiness
        </Badge>
        {view && (
          <Badge className={OVERALL_BADGE[view.status]}>{view.status}</Badge>
        )}
        <Button
          variant="outline"
          className="ml-auto h-8 border-white/15 bg-white/[0.03] text-slate-300 hover:bg-white/10"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh dependencies
        </Button>
      </div>

      {loading && !view && !error ? (
        <div className="flex items-center gap-3 py-6 text-slate-400" role="status" aria-live="polite">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Checking dependency health…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-300/25 bg-rose-300/10 px-5 py-4"
        >
          <p className="font-medium text-rose-100">Dependency status could not be loaded.</p>
          <p className="mt-1 text-xs text-slate-300">
            The readiness endpoint did not answer. Retrying automatically
            {retryInMs !== null ? ` in ${formatRetryDelay(retryInMs)}` : ""}.
          </p>
          <Button
            variant="outline"
            className="mt-3 h-8 border-white/15 bg-white/[0.03] text-slate-200 hover:bg-white/10"
            onClick={refresh}
          >
            Retry now
          </Button>
        </div>
      ) : view ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4">
            <OverallIcon status={view.status} />
            <p className="flex-1 min-w-0 text-sm font-medium text-white">
              {OVERALL_HEALTH_COPY[view.status]}
            </p>
            {view.cached && <span className="text-xs text-slate-400">cached</span>}
            {view.checkedAt && (
              <span className="text-xs text-slate-400">
                checked {new Date(view.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {retryInMs !== null && (
            <p className="text-xs text-amber-200" role="status" aria-live="polite">
              A critical dependency is unavailable. Retrying automatically in{" "}
              {formatRetryDelay(retryInMs)}.
            </p>
          )}

          {!view.reported ? (
            <p className="text-sm text-slate-400">
              This deployment does not report dependency-level health.
            </p>
          ) : view.dependencies.length === 0 ? (
            <p className="text-sm text-slate-400">No dependencies were reported.</p>
          ) : (
            view.dependencies.map((dependency) => (
              <div
                key={dependency.name}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4"
              >
                <DependencyIcon status={dependency.status} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white capitalize">
                    {dependency.name.replace(/_/g, " ")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {dependency.critical ? "Critical" : "Non-critical"}
                    {dependency.reason ? ` · ${dependency.reason}` : ""}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-slate-400">
                  {dependency.latencyMs} ms
                </span>
                <Badge className={STATUS_BADGE[dependency.status]}>
                  {DEPENDENCY_STATUS_COPY[dependency.status]}
                </Badge>
              </div>
            ))
          )}
        </>
      ) : null}
    </section>
  );
}
