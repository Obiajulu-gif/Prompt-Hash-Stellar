import FeatureFlag, { FeatureFlagEnvironment, FeatureFlagStatus } from "../models/FeatureFlag.js";
import { logger } from "./structuredLogger.js";

const ENVIRONMENT = (process.env.NODE_ENV || "development") as FeatureFlagEnvironment;

export type KnownFeatureFlag =
  | "stellar_atomic_settlement"
  | "bulk_purchase_atomic_v2"
  | "prompt_preview_markdown_sanitize_v2"
  | "payout_reconciliation_auto_resolve"
  | "operational_health_dashboard"
  | "strict_settlement_checks";

export interface FeatureFlagDefinition {
  name: string;
  description: string;
  defaultStatus: FeatureFlagStatus;
  defaultEnvironments: Record<FeatureFlagEnvironment, boolean>;
  safeFallback: boolean;
  rolloutPercentage?: number;
}

export const KNOWN_FEATURE_FLAGS: Record<string, FeatureFlagDefinition> = {
  stellar_atomic_settlement: {
    name: "stellar_atomic_settlement",
    description: "Enables Soroban atomic multi-prompt settlement transactions",
    defaultStatus: "disabled",
    defaultEnvironments: { development: true, staging: false, production: false },
    safeFallback: false,
    rolloutPercentage: 0,
  },
  bulk_purchase_atomic_v2: {
    name: "bulk_purchase_atomic_v2",
    description: "Enables v2 atomic bundle and cart checkout processor",
    defaultStatus: "disabled",
    defaultEnvironments: { development: true, staging: false, production: false },
    safeFallback: false,
    rolloutPercentage: 0,
  },
  prompt_preview_markdown_sanitize_v2: {
    name: "prompt_preview_markdown_sanitize_v2",
    description: "Enhanced HTML/Markdown sanitizer with strict iframe/script stripping",
    defaultStatus: "enabled",
    defaultEnvironments: { development: true, staging: true, production: true },
    safeFallback: true,
    rolloutPercentage: 100,
  },
  payout_reconciliation_auto_resolve: {
    name: "payout_reconciliation_auto_resolve",
    description: "Automatically reconcile zero-drift balanced payout ledgers",
    defaultStatus: "disabled",
    defaultEnvironments: { development: true, staging: false, production: false },
    safeFallback: false,
    rolloutPercentage: 0,
  },
  operational_health_dashboard: {
    name: "operational_health_dashboard",
    description: "Enables real-time operational health aggregation for maintainers",
    defaultStatus: "enabled",
    defaultEnvironments: { development: true, staging: true, production: true },
    safeFallback: true,
    rolloutPercentage: 100,
  },
  strict_settlement_checks: {
    name: "strict_settlement_checks",
    description: "Enforces on-chain transaction hash verification prior to entitlement grant",
    defaultStatus: "enabled",
    defaultEnvironments: { development: true, staging: true, production: true },
    safeFallback: true,
    rolloutPercentage: 100,
  },
};

/**
 * Flags that can never be left enabled by a rollout guard.
 * Emergency disablement is always permitted for these.
 */
export const EMERGENCY_DISABLE_ALLOWED_ROLES = ["admin", "maintainer"] as const;

export interface CreateFlagInput {
  name: string;
  description: string;
  status: FeatureFlagStatus;
  environments?: Partial<Record<FeatureFlagEnvironment, boolean>>;
  rolloutPercentage?: number;
  createdBy: string;
}

export interface UpdateFlagInput {
  status?: FeatureFlagStatus;
  environments?: Partial<Record<FeatureFlagEnvironment, boolean>>;
  rolloutPercentage?: number;
}

export interface FlagEvaluationResult {
  name: string;
  enabled: boolean;
  reason: string;
  source: "database" | "default_fallback" | "safe_fallback" | "emergency_disabled";
}

/** The audited, restorable view of a stored flag (#1026). */
export type FlagSnapshot = {
  name: string;
  description: string;
  status: FeatureFlagStatus;
  environments: Partial<Record<FeatureFlagEnvironment, boolean>>;
  rolloutPercentage: number;
  createdBy: string;
};

export interface RolloutGuardInput {
  /** Actor requesting the change. */
  actor: { id: string; role: string };
  /** Requested rollout percentage; values outside 0-100 are rejected. */
  rolloutPercentage?: number;
  /** Requested status change. */
  status?: FeatureFlagStatus;
}

export interface EmergencyDisableInput {
  actor: { id: string; role: string };
  reason: string;
}

export function snapshotFlag(flag: any): FlagSnapshot {
  const environments = flag.environments ?? {};
  return {
    name: flag.name,
    description: flag.description,
    status: flag.status,
    environments: {
      development: Boolean(environments.development),
      staging: Boolean(environments.staging),
      production: Boolean(environments.production),
    },
    rolloutPercentage: Number(flag.rolloutPercentage ?? 0),
    createdBy: flag.createdBy,
  };
}

/**
 * Validates a rollout change. Throws on invalid percentages or on attempts to
 * raise rollout by actors who are not authorized to do so.
 */
export function validateRolloutChange(input: RolloutGuardInput): void {
  if (input.rolloutPercentage !== undefined) {
    const pct = input.rolloutPercentage;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error(`Invalid rolloutPercentage: ${pct}. Must be a number between 0 and 100.`);
    }
  }
  if (input.rolloutPercentage !== undefined && input.rolloutPercentage > 0) {
    if (!(EMERGENCY_DISABLE_ALLOWED_ROLES as readonly string[]).includes(input.actor.role)) {
      throw new Error(`Actor ${input.actor.id} with role "${input.actor.role}" is not authorized to change rollout percentage.`);
    }
  }
}

class FeatureFlagService {
  /** Flags currently forced off by emergency disablement (in-process kill switch). */
  private emergencyDisabled = new Map<string, string>();

  getSafeFallback(flagName: string): boolean {
    const normalized = flagName.toLowerCase();
    if (normalized in KNOWN_FEATURE_FLAGS) {
      return KNOWN_FEATURE_FLAGS[normalized].safeFallback;
    }
    return false;
  }

  async createFlag(input: CreateFlagInput): Promise<any> {
    validateRolloutChange({
      actor: { id: input.createdBy, role: "admin" },
      rolloutPercentage: input.rolloutPercentage,
    });

    const flag = new FeatureFlag({
      name: input.name.toLowerCase(),
      description: input.description,
      status: input.status,
      environments: input.environments || {},
      rolloutPercentage: input.rolloutPercentage || 0,
      createdBy: input.createdBy,
    });

    await flag.save();
    logger.info(`Feature flag created: ${input.name}`);
    return flag;
  }

  /**
   * Guarded update: validates the rollout change and authorization before
   * writing. Non-admin actors may only lower rollout, not raise it.
   */
  async updateFlag(name: string, input: UpdateFlagInput, actor?: { id: string; role: string }): Promise<any> {
    if (actor) {
      validateRolloutChange({
        actor,
        rolloutPercentage: input.rolloutPercentage,
      });
    } else if (input.rolloutPercentage !== undefined) {
      validateRolloutChange({
        actor: { id: "system", role: "admin" },
        rolloutPercentage: input.rolloutPercentage,
      });
    }

    const flag = await FeatureFlag.findOneAndUpdate(
      { name: name.toLowerCase() },
      input,
      { new: true }
    );

    if (!flag) {
      throw new Error(`Feature flag not found: ${name}`);
    }

    logger.info(`Feature flag updated: ${name}`);
    return flag;
  }

  /**
   * Emergency kill switch. Immediately forces the flag off in this process
   * and persists status=disabled. Safe to call repeatedly (idempotent).
   */
  async emergencyDisable(name: string, input: EmergencyDisableInput): Promise<void> {
    const normalized = name.toLowerCase();
    if (!(EMERGENCY_DISABLE_ALLOWED_ROLES as readonly string[]).includes(input.actor.role)) {
      throw new Error(`Actor ${input.actor.id} is not authorized to emergency-disable flags.`);
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new Error("Emergency disable requires a non-empty reason.");
    }

    this.emergencyDisabled.set(normalized, input.reason);

    const result = await FeatureFlag.updateOne(
      { name: normalized },
      { $set: { status: "disabled", rolloutPercentage: 0 } },
    );
    if (result.matchedCount === 0) {
      // Flag absent in DB; in-memory kill switch still holds.
      logger.warn(`Emergency disable applied in-memory only; flag not in database: ${name}`);
    }

    logger.warn(`Feature flag EMERGENCY DISABLED: ${name} by ${input.actor.id}: ${input.reason}`);
  }

  /** Clears the in-process emergency disablement. Requires an authorized actor. */
  async clearEmergencyDisable(name: string, actor: { id: string; role: string }): Promise<void> {
    if (!(EMERGENCY_DISABLE_ALLOWED_ROLES as readonly string[]).includes(actor.role)) {
      throw new Error(`Actor ${actor.id} is not authorized to clear emergency disablement.`);
    }
    this.emergencyDisabled.delete(name.toLowerCase());
    logger.info(`Emergency disablement cleared: ${name} by ${actor.id}`);
  }

  isEmergencyDisabled(name: string): boolean {
    return this.emergencyDisabled.has(name.toLowerCase());
  }

  async deleteFlag(name: string): Promise<void> {
    const result = await FeatureFlag.deleteOne({ name: name.toLowerCase() });

    if (result.deletedCount === 0) {
      throw new Error(`Feature flag not found: ${name}`);
    }

    logger.info(`Feature flag deleted: ${name}`);
  }

  /**
   * Put a flag back exactly as captured by `snapshotFlag` — or remove it when
   * it did not exist (`null`). Used to roll back a change whose audit
   * evidence could not be recorded (#1026).
   */
  async restoreFlag(name: string, snapshot: FlagSnapshot | null): Promise<void> {
    const normalized = name.toLowerCase();
    if (!snapshot) {
      await FeatureFlag.deleteOne({ name: normalized });
      return;
    }
    await FeatureFlag.findOneAndUpdate(
      { name: normalized },
      { $set: { ...snapshot, name: normalized } },
      { upsert: true },
    );
  }

  async isEnabled(
    flagName: string | KnownFeatureFlag,
    environment?: FeatureFlagEnvironment,
    userId?: string
  ): Promise<boolean> {
    const evaluation = await this.evaluateFlag(flagName, environment, userId);
    return evaluation.enabled;
  }

  async evaluateFlag(
    flagName: string | KnownFeatureFlag,
    environment?: FeatureFlagEnvironment,
    userId?: string
  ): Promise<FlagEvaluationResult> {
    const normalized = flagName.toLowerCase();
    const env = environment || ENVIRONMENT;

    // Emergency kill switch takes precedence over every other rule.
    if (this.emergencyDisabled.has(normalized)) {
      return {
        name: normalized,
        enabled: false,
        reason: `Emergency disabled: ${this.emergencyDisabled.get(normalized)}`,
        source: "emergency_disabled",
      };
    }

    try {
      const flag = await FeatureFlag.findOne({
        name: normalized,
      });

      if (!flag) {
        const safeFallback = this.getSafeFallback(normalized);
        logger.warn(
          `Feature flag not found: ${flagName}, using safe fallback (${safeFallback})`
        );
        return {
          name: normalized,
          enabled: safeFallback,
          reason: "Flag not configured in database; fell back to safe default",
          source: "default_fallback",
        };
      }

      // Check if status is disabled globally
      if (flag.status === "disabled") {
        return {
          name: normalized,
          enabled: false,
          reason: "Flag is disabled globally",
          source: "database",
        };
      }

      // Check if environment is enabled
      if (!flag.environments[env]) {
        return {
          name: normalized,
          enabled: false,
          reason: `Flag is disabled in environment: ${env}`,
          source: "database",
        };
      }

      // Check rollout percentage for experimental flags
      if (flag.status === "experimental" && userId) {
        const isEligible = this.shouldEnableForUser(
          normalized,
          userId,
          flag.rolloutPercentage
        );
        return {
          name: normalized,
          enabled: isEligible,
          reason: `Experimental rollout (${flag.rolloutPercentage}%) evaluation for user ${userId}`,
          source: "database",
        };
      }

      if (flag.status === "experimental" && !userId) {
        // Without a userId for experimental rollout, fall back to safe default
        return {
          name: normalized,
          enabled: false,
          reason: "Experimental flag requested without userId context; defaulted to disabled",
          source: "database",
        };
      }

      return {
        name: normalized,
        enabled: true,
        reason: "Flag is enabled for environment",
        source: "database",
      };
    } catch (err) {
      const safeFallback = this.getSafeFallback(normalized);
      logger.error(
        `Error checking feature flag ${flagName}: ${err}. Using safe fallback (${safeFallback})`
      );
      return {
        name: normalized,
        enabled: safeFallback,
        reason: `Database error encountered: ${err}`,
        source: "safe_fallback",
      };
    }
  }

  async getFlag(name: string): Promise<any> {
    return FeatureFlag.findOne({ name: name.toLowerCase() });
  }

  async getAllFlags(): Promise<any[]> {
    return FeatureFlag.find({});
  }

  async getFlagsForEnvironment(environment: FeatureFlagEnvironment): Promise<any[]> {
    return FeatureFlag.find({
      [`environments.${environment}`]: true,
      status: { $ne: "disabled" },
    });
  }

  private shouldEnableForUser(
    flagName: string,
    userId: string,
    rolloutPercentage: number
  ): boolean {
    if (rolloutPercentage === 0) return false;
    if (rolloutPercentage === 100) return true;

    // Consistent hashing: same user always gets same result
    const combined = `${flagName}:${userId}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      hash = (hash << 5) - hash + combined.charCodeAt(i);
      hash = hash & hash;
    }

    const percentage = Math.abs(hash) % 100;
    return percentage < rolloutPercentage;
  }
}

export const featureFlagService = new FeatureFlagService();
