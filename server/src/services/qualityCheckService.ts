import QualityCheckResult, { CheckSeverity, QualityCheck } from "../models/QualityCheckResult.js";
import Prompt from "../models/Prompt.js";
import { logger } from "./auditTrail.js";

const QUALITY_RULES: Record<string, { description: string; severity: CheckSeverity; validate: (prompt: any) => boolean }> = {
  has_title: {
    description: "Prompt must have a clear title (minimum 5 characters)",
    severity: "blocking",
    validate: (prompt) => prompt.title && prompt.title.trim().length >= 5,
  },
  has_description: {
    description: "Prompt should have a detailed description (minimum 20 characters)",
    severity: "warning",
    validate: (prompt) => prompt.description && prompt.description.trim().length >= 20,
  },
  has_category: {
    description: "Prompt must have a valid category",
    severity: "blocking",
    validate: (prompt) => prompt.category && prompt.category !== "Other",
  },
  has_tags: {
    description: "Prompt should have at least 2 tags for discoverability",
    severity: "warning",
    validate: (prompt) => Array.isArray(prompt.tags) && prompt.tags.length >= 2,
  },
  valid_price: {
    description: "Prompt must have a price greater than 0 for paid publication",
    severity: "blocking",
    validate: (prompt) => typeof prompt.price === "number" && prompt.price > 0,
  },
  content_quality: {
    description: "Prompt content must be substantial (minimum 50 characters)",
    severity: "blocking",
    validate: (prompt) => prompt.content && prompt.content.trim().length >= 50,
  },
  examples_included: {
    description: "Prompt should include usage examples in description or content",
    severity: "warning",
    validate: (prompt) => {
      const combined = `${prompt.description} ${prompt.content}`.toLowerCase();
      return combined.includes("example") || combined.includes("usage");
    },
  },
};

class QualityCheckService {
  async runChecks(promptId: string): Promise<any> {
    const prompt = await Prompt.findById(promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${promptId}`);
    }

    const checks: QualityCheck[] = [];

    for (const [ruleName, rule] of Object.entries(QUALITY_RULES)) {
      const passed = rule.validate(prompt);
      checks.push({
        name: ruleName,
        description: rule.description,
        severity: rule.severity,
        passed,
        message: passed ? "Passed" : `Failed: ${rule.description}`,
      });
    }

    const blockingFailures = checks.filter((c) => c.severity === "blocking" && !c.passed);
    const overallStatus = blockingFailures.length === 0 ? "passed" : "failed";

    let result = await QualityCheckResult.findOne({ promptId });
    if (!result) {
      result = new QualityCheckResult({ promptId });
    }

    result.checks = checks;
    result.overallStatus = overallStatus;

    if (overallStatus === "passed") {
      result.passedAt = new Date();
      result.blockedAt = undefined;
    } else {
      result.blockedAt = new Date();
      result.passedAt = undefined;
    }

    await result.save();
    logger.info(`Quality checks completed for prompt ${promptId}: ${overallStatus}`);
    return result;
  }

  async getCheckResult(promptId: string): Promise<any> {
    return QualityCheckResult.findOne({ promptId });
  }

  async canPublishPaid(promptId: string): Promise<{ canPublish: boolean; failures: string[] }> {
    const result = await this.getCheckResult(promptId);

    if (!result) {
      return {
        canPublish: false,
        failures: ["No quality checks run. Please run checks first."],
      };
    }

    const failures = result.checks
      .filter((c) => !c.passed)
      .map((c) => c.message || `Failed: ${c.name}`);

    const isOverridden = result.overriddenAt && !result.blockedAt;
    const blockingFailures = result.checks.filter((c) => c.severity === "blocking" && !c.passed);

    return {
      canPublish: isOverridden || blockingFailures.length === 0,
      failures,
    };
  }

  async overrideChecks(
    promptId: string,
    overriddenBy: string,
    reason: string
  ): Promise<any> {
    const result = await QualityCheckResult.findOne({ promptId });
    if (!result) {
      throw new Error(`Quality check result not found: ${promptId}`);
    }

    result.overriddenAt = new Date();
    result.overriddenBy = overriddenBy.toLowerCase();
    result.overrideReason = reason;

    await result.save();
    logger.info(`Quality checks overridden for prompt ${promptId} by ${overriddenBy}`);
    return result;
  }

  async getCheckHistory(promptId: string): Promise<any> {
    const result = await QualityCheckResult.findOne({ promptId });
    return {
      promptId,
      checks: result?.checks || [],
      status: result?.overallStatus || "unknown",
      overridden: !!result?.overriddenAt,
      history: {
        checkedAt: result?.updatedAt,
        passedAt: result?.passedAt,
        blockedAt: result?.blockedAt,
        overriddenAt: result?.overriddenAt,
        overriddenBy: result?.overriddenBy,
      },
    };
  }

  getQualityRules(): Record<string, { description: string; severity: CheckSeverity }> {
    const rules: Record<string, { description: string; severity: CheckSeverity }> = {};
    for (const [name, rule] of Object.entries(QUALITY_RULES)) {
      rules[name] = { description: rule.description, severity: rule.severity };
    }
    return rules;
  }
}

export const qualityCheckService = new QualityCheckService();
