import { metrics } from "./metrics";

export type AuditScope =
  | "marketplace_load"
  | "prompt_detail_load"
  | "browse_load"
  | "sell_form_load"
  | "profile_load"
  | "wallet_connect"
  | "purchase_flow"
  | string;

export interface AuditEntry {
  scope: AuditScope;
  startedAt: number;
  duration: number;
  metadata?: Record<string, string | number | boolean>;
}

const BUDGET_MS: Record<string, number> = {
  marketplace_load: 1500,
  prompt_detail_load: 1000,
  browse_load: 1200,
  sell_form_load: 800,
  profile_load: 1000,
  wallet_connect: 3000,
  purchase_flow: 5000,
};

const _log: AuditEntry[] = [];

export function startAudit(scope: AuditScope): () => AuditEntry {
  const startedAt = performance.now();

  return (metadata?: Record<string, string | number | boolean>): AuditEntry => {
    const duration = Math.round(performance.now() - startedAt);
    const entry: AuditEntry = { scope, startedAt, duration, metadata };
    _log.push(entry);

    metrics.emit(`perf_${scope}_duration_ms`, duration, { scope });

    const budget = BUDGET_MS[scope];
    if (budget !== undefined && duration > budget) {
      metrics.emit("perf_budget_exceeded_total", 1, {
        scope,
        budget_ms: budget,
        actual_ms: duration,
      });
    }

    return entry;
  };
}

export function getAuditLog(): readonly AuditEntry[] {
  return _log;
}

export function clearAuditLog(): void {
  _log.splice(0, _log.length);
}

export function getAuditSummary(): {
  scope: AuditScope;
  count: number;
  avgMs: number;
  maxMs: number;
  overBudget: number;
}[] {
  const byScope = new Map<
    AuditScope,
    { total: number; count: number; max: number; overBudget: number }
  >();

  for (const entry of _log) {
    const existing = byScope.get(entry.scope) ?? {
      total: 0,
      count: 0,
      max: 0,
      overBudget: 0,
    };
    const budget = BUDGET_MS[entry.scope] ?? Infinity;
    byScope.set(entry.scope, {
      total: existing.total + entry.duration,
      count: existing.count + 1,
      max: Math.max(existing.max, entry.duration),
      overBudget: existing.overBudget + (entry.duration > budget ? 1 : 0),
    });
  }

  return Array.from(byScope.entries()).map(([scope, data]) => ({
    scope,
    count: data.count,
    avgMs: Math.round(data.total / data.count),
    maxMs: data.max,
    overBudget: data.overBudget,
  }));
}
