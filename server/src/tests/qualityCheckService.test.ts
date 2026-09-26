import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { qualityCheckService } from "../services/qualityCheckService.js";
import QualityCheckResult from "../models/QualityCheckResult.js";
import Prompt from "../models/Prompt.js";
import mongoose from "mongoose";

describe("QualityCheckService", () => {
  let promptId: string;

  beforeEach(async () => {
    await QualityCheckResult.deleteMany({});
    await Prompt.deleteMany({});

    // Create a test prompt
    const prompt = new Prompt({
      title: "Test Prompt Title",
      content: "This is a detailed test prompt content with substantial length",
      description: "A comprehensive description of the prompt",
      category: "Writing",
      price: 10,
      tags: ["ai", "writing"],
      owner: new mongoose.Types.ObjectId(),
    });
    await prompt.save();
    promptId = prompt._id.toString();
  });

  afterEach(async () => {
    await QualityCheckResult.deleteMany({});
    await Prompt.deleteMany({});
  });

  it("should run quality checks on a prompt", async () => {
    const result = await qualityCheckService.runChecks(promptId);

    expect(result.promptId).toBe(promptId);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.overallStatus).toBe("passed");
  });

  it("should detect blocking failures", async () => {
    const prompt = await Prompt.findById(promptId);
    prompt.title = ""; // Clear title - should fail
    await prompt.save();

    const result = await qualityCheckService.runChecks(promptId);

    const titleCheck = result.checks.find((c: any) => c.name === "has_title");
    expect(titleCheck?.passed).toBe(false);
    expect(titleCheck?.severity).toBe("blocking");
  });

  it("should detect warning failures", async () => {
    const prompt = await Prompt.findById(promptId);
    prompt.tags = []; // Clear tags - should warn
    await prompt.save();

    const result = await qualityCheckService.runChecks(promptId);

    const tagsCheck = result.checks.find((c: any) => c.name === "has_tags");
    expect(tagsCheck?.passed).toBe(false);
    expect(tagsCheck?.severity).toBe("warning");
    expect(result.overallStatus).toBe("passed"); // Warning doesn't block
  });

  it("should check if prompt can publish paid", async () => {
    const result = await qualityCheckService.canPublishPaid(promptId);

    expect(result.canPublish).toBe(true);
    expect(result.failures.length).toBe(0);
  });

  it("should prevent paid publication with blocking failures", async () => {
    const prompt = await Prompt.findById(promptId);
    prompt.price = 0; // Invalid price
    await prompt.save();

    await qualityCheckService.runChecks(promptId);
    const result = await qualityCheckService.canPublishPaid(promptId);

    expect(result.canPublish).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("should allow override of quality checks", async () => {
    const prompt = await Prompt.findById(promptId);
    prompt.price = 0; // Invalid price
    await prompt.save();

    await qualityCheckService.runChecks(promptId);
    await qualityCheckService.overrideChecks(
      promptId,
      "admin@example.com",
      "Approved by manager"
    );

    const result = await qualityCheckService.canPublishPaid(promptId);
    expect(result.canPublish).toBe(true);
  });

  it("should get quality check history", async () => {
    await qualityCheckService.runChecks(promptId);
    const history = await qualityCheckService.getCheckHistory(promptId);

    expect(history.promptId).toBe(promptId);
    expect(history.checks.length).toBeGreaterThan(0);
    expect(history.status).toBe("passed");
  });

  it("should provide quality rules documentation", () => {
    const rules = qualityCheckService.getQualityRules();

    expect(rules).toHaveProperty("has_title");
    expect(rules).toHaveProperty("has_category");
    expect(rules).toHaveProperty("valid_price");
    expect(rules.has_title.severity).toBe("blocking");
  });
});
