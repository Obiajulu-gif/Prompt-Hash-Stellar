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
  source: "database" | "default_fallback" | "safe_fallback";
}

class FeatureFlagService {
  getSafeFallback(flagName: string): boolean {
    const normalized = flagName.toLowerCase();
    if (normalized in KNOWN_FEATURE_FLAGS) {
      return KNOWN_FEATURE_FLAGS[normalized].safeFallback;
    }
    return false;
  }

  async createFlag(input: CreateFlagInput): Promise<any> {
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

  async updateFlag(name: string, input: UpdateFlagInput): Promise<any> {
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

  async deleteFlag(name: string): Promise<void> {
    const result = await FeatureFlag.deleteOne({ name: name.toLowerCase() });

    if (result.deletedCount === 0) {
      throw new Error(`Feature flag not found: ${name}`);
    }

    logger.info(`Feature flag deleted: ${name}`);
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

