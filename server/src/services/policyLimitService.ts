import { logger } from "./structuredLogger";
import { recordAuditEvent } from "./auditTrail";

export type OperationCategory = "STORAGE" | "INDEXING" | "COMPUTE" | "EXTERNAL_SERVICES";

export type ExpensiveOperation =
  | "STORAGE_PROMPT_PAYLOAD"
  | "STORAGE_BULK_IMPORT"
  | "INDEXING_REINDEX_CATALOG"
  | "INDEXING_DEEP_SEARCH"
  | "COMPUTE_AI_IMPROVE"
  | "COMPUTE_SAFETY_SCAN"
  | "COMPUTE_SIMILARITY_CHECK"
  | "EXTERNAL_WEBHOOK_DELIVERY"
  | "EXTERNAL_HORIZON_QUERY";

export interface PolicyDefinition {
  operation: ExpensiveOperation;
  category: OperationCategory;
  description: string;
  defaultLimit: number;
  windowSeconds: number; // 0 for size-based limits
  isSizeLimit?: boolean; // true if limit is in bytes/items, not rate/window
  remediationAdvice: string;
}

export interface PolicyOverride {
  overrideId: string;
  scopeType: "wallet" | "apiKey" | "ip" | "global";
  scopeValue: string;
  operation: ExpensiveOperation;
  limit: number;
  expiresAt: number; // Unix ms
  reason: string;
  grantedBy: string;
  createdAt: number;
  revokedAt?: number;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  operation: ExpensiveOperation;
  category: OperationCategory;
  limit: number;
  currentUsage: number;
  remaining: number;
  resetAtSeconds: number;
  retryAfterSeconds: number;
  remediation?: string;
  overrideApplied?: boolean;
}

export const POLICIES: Record<ExpensiveOperation, PolicyDefinition> = {
  STORAGE_PROMPT_PAYLOAD: {
    operation: "STORAGE_PROMPT_PAYLOAD",
    category: "STORAGE",
    description: "Maximum payload size for prompt creation and draft storage in bytes",
    defaultLimit: 65536, // 64 KB
    windowSeconds: 0,
    isSizeLimit: true,
    remediationAdvice: "Reduce the prompt text length or attached metadata to less than 64KB before submitting.",
  },
  STORAGE_BULK_IMPORT: {
    operation: "STORAGE_BULK_IMPORT",
    category: "STORAGE",
    description: "Maximum batch items allowed in a single bulk prompt import operation",
    defaultLimit: 50,
    windowSeconds: 0,
    isSizeLimit: true,
    remediationAdvice: "Split bulk imports into batches of 50 items or fewer.",
  },
  INDEXING_REINDEX_CATALOG: {
    operation: "INDEXING_REINDEX_CATALOG",
    category: "INDEXING",
    description: "Manual catalog re-indexing triggers per hour",
    defaultLimit: 2,
    windowSeconds: 3600,
    remediationAdvice: "Catalog re-indexing is rate-limited. Wait for the automated indexing scheduler or retry later.",
  },
  INDEXING_DEEP_SEARCH: {
    operation: "INDEXING_DEEP_SEARCH",
    category: "INDEXING",
    description: "Maximum pagination offset / depth for search queries",
    defaultLimit: 500, // Max offset of 500 records
    windowSeconds: 0,
    isSizeLimit: true,
    remediationAdvice: "Refine your search query, apply filters, or use cursor-based pagination instead of deep page offsets.",
  },
  COMPUTE_AI_IMPROVE: {
    operation: "COMPUTE_AI_IMPROVE",
    category: "COMPUTE",
    description: "AI prompt improvement generation calls per 15 minutes",
    defaultLimit: 10,
    windowSeconds: 900,
    remediationAdvice: "You have exceeded the prompt improvement quota for this window. Wait for the cooldown period or edit drafts manually.",
  },
  COMPUTE_SAFETY_SCAN: {
    operation: "COMPUTE_SAFETY_SCAN",
    category: "COMPUTE",
    description: "Automated content safety scans per minute",
    defaultLimit: 30,
    windowSeconds: 60,
    remediationAdvice: "Safety scan requests are throttled. Please pause briefly before submitting additional prompt validations.",
  },
  COMPUTE_SIMILARITY_CHECK: {
    operation: "COMPUTE_SIMILARITY_CHECK",
    category: "COMPUTE",
    description: "Prompt duplicate and similarity scans per minute",
    defaultLimit: 20,
    windowSeconds: 60,
    remediationAdvice: "Duplicate detection rate limit reached. Wait a moment before checking similarity again.",
  },
  EXTERNAL_WEBHOOK_DELIVERY: {
    operation: "EXTERNAL_WEBHOOK_DELIVERY",
    category: "EXTERNAL_SERVICES",
    description: "Outbound webhook notifications sent per minute",
    defaultLimit: 60,
    windowSeconds: 60,
    remediationAdvice: "Outbound webhook dispatch limit reached. Webhooks will be queued in the outbox.",
  },
  EXTERNAL_HORIZON_QUERY: {
    operation: "EXTERNAL_HORIZON_QUERY",
    category: "EXTERNAL_SERVICES",
    description: "Direct Horizon / RPC calls per minute",
    defaultLimit: 120,
    windowSeconds: 60,
    remediationAdvice: "Stellar RPC lookup limit reached. Use cached marketplace query results where possible.",
  },
};

interface WindowEntry {
  count: number;
  resetAt: number;
}

class PolicyLimitService {
  private overrides: Map<string, PolicyOverride> = new Map();
  private rateStores: Map<string, Map<string, WindowEntry>> = new Map();

  constructor() {
    // Periodic cleanup of expired entries
    const cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
    if (cleanupInterval.unref) cleanupInterval.unref();
  }

  private cleanup() {
    const now = Date.now();
    for (const [_, store] of this.rateStores.entries()) {
      for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) {
          store.delete(key);
        }
      }
    }
  }

  /**
   * Resolve applicable limit considering scoped overrides.
   */
  public resolveLimit(
    operation: ExpensiveOperation,
    scopes: { wallet?: string; apiKey?: string; ip?: string }
  ): { limit: number; override?: PolicyOverride } {
    const now = Date.now();
    const policy = POLICIES[operation];
    const defaultLimit = policy?.defaultLimit ?? 100;

    // Check overrides in precedence order: wallet > apiKey > ip > global
    const scopeKeys = [
      scopes.wallet ? `wallet:${scopes.wallet.toLowerCase()}:${operation}` : null,
      scopes.apiKey ? `apiKey:${scopes.apiKey}:${operation}` : null,
      scopes.ip ? `ip:${scopes.ip}:${operation}` : null,
      `global:*:${operation}`,
    ].filter(Boolean) as string[];

    for (const key of scopeKeys) {
      const override = this.overrides.get(key);
      if (override && !override.revokedAt && override.expiresAt > now) {
        return { limit: override.limit, override };
      }
    }

    return { limit: defaultLimit };
  }

  /**
   * Evaluate whether an operation is allowed under current policy limits.
   */
  public evaluate(params: {
    operation: ExpensiveOperation;
    actor: { wallet?: string; apiKey?: string; ip?: string };
    costOrSize?: number;
  }): PolicyEvaluationResult {
    const { operation, actor, costOrSize = 1 } = params;
    const policy = POLICIES[operation];
    if (!policy) {
      return {
        allowed: true,
        operation,
        category: "COMPUTE",
        limit: 1000,
        currentUsage: 0,
        remaining: 1000,
        resetAtSeconds: Math.floor(Date.now() / 1000),
        retryAfterSeconds: 0,
      };
    }

    const { limit, override } = this.resolveLimit(operation, actor);
    const now = Date.now();

    // 1. Size / volume based limit (not windowed rate)
    if (policy.isSizeLimit) {
      const allowed = costOrSize <= limit;
      return {
        allowed,
        operation,
        category: policy.category,
        limit,
        currentUsage: costOrSize,
        remaining: allowed ? limit - costOrSize : 0,
        resetAtSeconds: Math.floor(now / 1000),
        retryAfterSeconds: allowed ? 0 : 1,
        remediation: allowed ? undefined : policy.remediationAdvice,
        overrideApplied: Boolean(override),
      };
    }

    // 2. Rate / window based limit
    const windowMs = policy.windowSeconds * 1000;
    const storeKey = `policy_${operation}`;
    if (!this.rateStores.has(storeKey)) {
      this.rateStores.set(storeKey, new Map());
    }
    const store = this.rateStores.get(storeKey)!;

    const actorKey = actor.wallet?.toLowerCase() || actor.apiKey || actor.ip || "unknown";
    const entry = store.get(actorKey);

    if (!entry || now > entry.resetAt) {
      store.set(actorKey, { count: costOrSize, resetAt: now + windowMs });
      return {
        allowed: true,
        operation,
        category: policy.category,
        limit,
        currentUsage: costOrSize,
        remaining: Math.max(0, limit - costOrSize),
        resetAtSeconds: Math.ceil((now + windowMs) / 1000),
        retryAfterSeconds: 0,
        overrideApplied: Boolean(override),
      };
    }

    if (entry.count + costOrSize > limit) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return {
        allowed: false,
        operation,
        category: policy.category,
        limit,
        currentUsage: entry.count,
        remaining: 0,
        resetAtSeconds: Math.ceil(entry.resetAt / 1000),
        retryAfterSeconds: retryAfter,
        remediation: `${policy.remediationAdvice} (Retry in ${retryAfter} seconds)`,
        overrideApplied: Boolean(override),
      };
    }

    entry.count += costOrSize;
    return {
      allowed: true,
      operation,
      category: policy.category,
      limit,
      currentUsage: entry.count,
      remaining: Math.max(0, limit - entry.count),
      resetAtSeconds: Math.ceil(entry.resetAt / 1000),
      retryAfterSeconds: 0,
      overrideApplied: Boolean(override),
    };
  }

  /**
   * Register a scoped policy override with audit logging.
   */
  public async addOverride(params: {
    scopeType: "wallet" | "apiKey" | "ip" | "global";
    scopeValue: string;
    operation: ExpensiveOperation;
    limit: number;
    durationSeconds: number;
    reason: string;
    grantedBy: string;
  }): Promise<PolicyOverride> {
    const now = Date.now();
    const overrideId = `povr_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const normalizedScopeValue =
      params.scopeType === "wallet" ? params.scopeValue.toLowerCase() : params.scopeValue;

    const override: PolicyOverride = {
      overrideId,
      scopeType: params.scopeType,
      scopeValue: normalizedScopeValue,
      operation: params.operation,
      limit: params.limit,
      expiresAt: now + params.durationSeconds * 1000,
      reason: params.reason,
      grantedBy: params.grantedBy,
      createdAt: now,
    };

    const mapKey = `${params.scopeType}:${normalizedScopeValue}:${params.operation}`;
    this.overrides.set(mapKey, override);

    // Audit override creation
    try {
      await recordAuditEvent({
        action: "policy_override_created",
        result: "success",
        actor: params.grantedBy,
        target: `${params.scopeType}:${normalizedScopeValue}`,
        targetType: "policy_limit",
        reason: params.reason,
        beforeState: { defaultLimit: POLICIES[params.operation]?.defaultLimit },
        afterState: {
          overrideId,
          operation: params.operation,
          limit: params.limit,
          expiresAt: new Date(override.expiresAt).toISOString(),
        },
      });
    } catch (err) {
      logger.warn("Could not audit policy override creation", { error: err });
    }

    logger.info("Policy override created", { overrideId, operation: params.operation, limit: params.limit });
    return override;
  }

  /**
   * Revoke an active override with audit logging.
   */
  public async revokeOverride(overrideId: string, revokedBy: string, reason: string): Promise<boolean> {
    for (const [key, override] of this.overrides.entries()) {
      if (override.overrideId === overrideId && !override.revokedAt) {
        override.revokedAt = Date.now();

        try {
          await recordAuditEvent({
            action: "policy_override_revoked",
            result: "success",
            actor: revokedBy,
            target: overrideId,
            targetType: "policy_limit",
            reason,
            beforeState: { overrideId, limit: override.limit },
            afterState: { revokedAt: new Date(override.revokedAt).toISOString() },
          });
        } catch (err) {
          logger.warn("Could not audit policy override revocation", { error: err });
        }

        this.overrides.delete(key);
        return true;
      }
    }
    return false;
  }

  /**
   * List all policies and active overrides.
   */
  public getStatus() {
    const now = Date.now();
    const activeOverrides = Array.from(this.overrides.values()).filter(
      (o) => !o.revokedAt && o.expiresAt > now
    );

    return {
      policies: Object.values(POLICIES),
      activeOverrides,
    };
  }

  /**
   * Reset limits for test or admin intervention.
   */
  public reset(operation?: ExpensiveOperation) {
    if (operation) {
      this.rateStores.delete(`policy_${operation}`);
    } else {
      this.rateStores.clear();
      this.overrides.clear();
    }
  }
}

export const policyLimitService = new PolicyLimitService();
