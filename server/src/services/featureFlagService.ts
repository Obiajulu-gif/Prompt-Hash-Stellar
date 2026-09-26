import FeatureFlag, { FeatureFlagEnvironment, FeatureFlagStatus } from "../models/FeatureFlag.js";
import { logger } from "./auditTrail.js";

const ENVIRONMENT = (process.env.NODE_ENV || "development") as FeatureFlagEnvironment;

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

class FeatureFlagService {
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
    flagName: string,
    environment?: FeatureFlagEnvironment,
    userId?: string
  ): Promise<boolean> {
    const env = environment || ENVIRONMENT;

    try {
      const flag = await FeatureFlag.findOne({
        name: flagName.toLowerCase(),
      });

      if (!flag) {
        logger.warn(`Feature flag not found: ${flagName}, defaulting to false`);
        return false;
      }

      // Check if status is disabled globally
      if (flag.status === "disabled") {
        return false;
      }

      // Check if environment is enabled
      if (!flag.environments[env]) {
        return false;
      }

      // Check rollout percentage for experimental flags
      if (flag.status === "experimental" && userId) {
        return this.shouldEnableForUser(flagName, userId, flag.rolloutPercentage);
      }

      return true;
    } catch (err) {
      logger.error(`Error checking feature flag ${flagName}: ${err}`);
      return false;
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
