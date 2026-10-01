import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  featureFlagService,
  KNOWN_FEATURE_FLAGS,
} from "../services/featureFlagService.js";
import FeatureFlag from "../models/FeatureFlag.js";

describe("FeatureFlagService", () => {
  const store = new Map<string, any>();

  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();

    vi.spyOn(FeatureFlag.prototype, "save").mockImplementation(function (this: any) {
      store.set(this.name.toLowerCase(), this);
      return Promise.resolve(this);
    });

    vi.spyOn(FeatureFlag, "findOne").mockImplementation((query: any) => {
      const name = query?.name?.toLowerCase ? query.name.toLowerCase() : query?.name;
      const found = store.get(name);
      return found ? (found as any) : null;
    });

    vi.spyOn(FeatureFlag, "findOneAndUpdate").mockImplementation((query: any, update: any) => {
      const name = query?.name?.toLowerCase ? query.name.toLowerCase() : query?.name;
      const existing = store.get(name);
      if (!existing) return Promise.resolve(null) as any;
      const updated = {
        ...existing,
        ...update,
        environments: {
          ...(existing.environments || {}),
          ...(update.environments || {}),
        },
      };
      store.set(name, updated);
      return Promise.resolve(updated) as any;
    });

    vi.spyOn(FeatureFlag, "deleteOne").mockImplementation((query: any) => {
      const name = query?.name?.toLowerCase ? query.name.toLowerCase() : query?.name;
      const existed = store.delete(name);
      return Promise.resolve({ deletedCount: existed ? 1 : 0 }) as any;
    });

    vi.spyOn(FeatureFlag, "deleteMany").mockImplementation(() => {
      store.clear();
      return Promise.resolve({ deletedCount: 0 }) as any;
    });

    vi.spyOn(FeatureFlag, "find").mockImplementation(() => {
      return Array.from(store.values()) as any;
    });
  });

  afterEach(() => {
    store.clear();
    vi.restoreAllMocks();
  });

  it("should define typed known flags with safe defaults", () => {
    expect(KNOWN_FEATURE_FLAGS.stellar_atomic_settlement).toBeDefined();
    expect(KNOWN_FEATURE_FLAGS.stellar_atomic_settlement.safeFallback).toBe(false);
    expect(KNOWN_FEATURE_FLAGS.prompt_preview_markdown_sanitize_v2.safeFallback).toBe(true);
    expect(KNOWN_FEATURE_FLAGS.operational_health_dashboard.safeFallback).toBe(true);
  });

  it("should create a feature flag", async () => {
    const flag = await featureFlagService.createFlag({
      name: "new-payment-flow",
      description: "New payment flow experiment",
      status: "experimental",
      environments: { development: true, staging: true },
      rolloutPercentage: 25,
      createdBy: "admin@example.com",
    });

    expect(flag.name).toBe("new-payment-flow");
    expect(flag.status).toBe("experimental");
    expect(flag.rolloutPercentage).toBe(25);
  });

  it("should check if flag is enabled in development", async () => {
    await featureFlagService.createFlag({
      name: "dev-feature",
      description: "Dev only feature",
      status: "enabled",
      environments: { development: true },
      createdBy: "admin@example.com",
    });

    const isEnabled = await featureFlagService.isEnabled(
      "dev-feature",
      "development"
    );
    expect(isEnabled).toBe(true);
  });

  it("should return false for disabled flags", async () => {
    await featureFlagService.createFlag({
      name: "disabled-feature",
      description: "Disabled feature",
      status: "disabled",
      environments: { development: false },
      createdBy: "admin@example.com",
    });

    const isEnabled = await featureFlagService.isEnabled("disabled-feature");
    expect(isEnabled).toBe(false);
  });

  it("should fall back safely for missing flags", async () => {
    // Known flag with false fallback
    const atomicSettlement = await featureFlagService.isEnabled(
      "stellar_atomic_settlement"
    );
    expect(atomicSettlement).toBe(false);

    // Known flag with true safe fallback
    const sanitizeV2 = await featureFlagService.isEnabled(
      "prompt_preview_markdown_sanitize_v2"
    );
    expect(sanitizeV2).toBe(true);

    // Unknown flag should default to false
    const unknownFlag = await featureFlagService.isEnabled("non_existent_flag");
    expect(unknownFlag).toBe(false);
  });

  it("should fall back safely when database throws error", async () => {
    vi.spyOn(FeatureFlag, "findOne").mockRejectedValueOnce(new Error("Mongo network error"));

    const evaluation = await featureFlagService.evaluateFlag(
      "stellar_atomic_settlement"
    );
    expect(evaluation.enabled).toBe(false);
    expect(evaluation.source).toBe("safe_fallback");
  });

  it("should update a flag", async () => {
    await featureFlagService.createFlag({
      name: "test-flag",
      description: "Test flag",
      status: "disabled",
      createdBy: "admin@example.com",
    });

    const updated = await featureFlagService.updateFlag("test-flag", {
      status: "enabled",
      environments: { production: true },
    });

    expect(updated.status).toBe("enabled");
    expect(updated.environments.production).toBe(true);
  });

  it("should handle experimental flag rollout deterministically", async () => {
    await featureFlagService.createFlag({
      name: "experimental-feature",
      description: "Experimental feature",
      status: "experimental",
      environments: { development: true },
      rolloutPercentage: 50,
      createdBy: "admin@example.com",
    });

    // Test with specific user IDs
    const user1Enabled = await featureFlagService.isEnabled(
      "experimental-feature",
      "development",
      "user1"
    );

    // Both should be consistent when called again
    const user1Enabled2 = await featureFlagService.isEnabled(
      "experimental-feature",
      "development",
      "user1"
    );
    expect(user1Enabled).toBe(user1Enabled2);

    // Without userId, experimental flag should evaluate to false
    const anonymousEnabled = await featureFlagService.isEnabled(
      "experimental-feature",
      "development"
    );
    expect(anonymousEnabled).toBe(false);
  });

  it("should delete a flag", async () => {
    await featureFlagService.createFlag({
      name: "temp-flag",
      description: "Temporary flag",
      status: "disabled",
      createdBy: "admin@example.com",
    });

    await featureFlagService.deleteFlag("temp-flag");
    const flag = await featureFlagService.getFlag("temp-flag");
    expect(flag).toBeNull();
  });
});
