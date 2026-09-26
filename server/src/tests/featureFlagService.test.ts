import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { featureFlagService } from "../services/featureFlagService.js";
import FeatureFlag from "../models/FeatureFlag.js";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

describe("FeatureFlagService", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    // Clear the collection before each test
    await FeatureFlag.deleteMany({});
  });

  afterEach(async () => {
    await FeatureFlag.deleteMany({});
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

  it("should handle experimental flag rollout", async () => {
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
    const user2Enabled = await featureFlagService.isEnabled(
      "experimental-feature",
      "development",
      "user2"
    );

    // Both should be consistent when called again
    const user1Enabled2 = await featureFlagService.isEnabled(
      "experimental-feature",
      "development",
      "user1"
    );
    expect(user1Enabled).toBe(user1Enabled2);
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
