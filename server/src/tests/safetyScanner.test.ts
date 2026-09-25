import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  scanPromptContent,
  scanUnavailable,
  withFailSafe,
  type SafetyScanner,
} from "../services/safetyScanner";
import { statusFromVerdict, canOverride, validateOverride } from "../moderation/types";
import { applySafetyScan } from "../services/safetyScannerHook";

const baseInput = {
  title: "A friendly writing assistant",
  description: "Helps you draft blog posts",
  tags: ["writing"],
  preview: "Once upon a time",
  payload: "Write a warm intro paragraph",
};

describe("safetyScanner — heuristic outcomes (#758)", () => {
  it("allows a clean prompt", async () => {
    const result = await scanPromptContent(baseInput);
    expect(result.verdict).toBe("allow");
    expect(result.ruleIds).toEqual([]);
    expect(result.scanned).toBe(true);
  });

  it("queues a prompt matching a queue rule", async () => {
    const result = await scanPromptContent({
      ...baseInput,
      description: "Explains how to make a bomb in a game world",
    });
    expect(result.verdict).toBe("queue");
    expect(result.ruleIds).toContain("violence");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("scans tags as well as title and description", async () => {
    const result = await scanPromptContent({ ...baseInput, tags: ["keylogger"] });
    expect(result.verdict).toBe("queue");
    expect(result.ruleIds).toContain("malware");
  });

  it("blocks on a high-confidence child-safety match", async () => {
    const result = await scanPromptContent({
      ...baseInput,
      description: "Requesting csam content",
    });
    expect(result.verdict).toBe("block");
    expect(result.ruleIds).toContain("child-safety");
  });

  it("block dominates queue when both match", async () => {
    const result = await scanPromptContent({
      ...baseInput,
      title: "suicide support group",
      description: "csam reference",
    });
    expect(result.verdict).toBe("block");
  });

  it("scans the hidden payload but never from untrusted callers", async () => {
    // The payload is scanned server-side only; the route layer is responsible
    // for not sending it to unauthorized clients.
    const result = await scanPromptContent({ ...baseInput, payload: "ransomware builder" });
    expect(result.verdict).toBe("queue");
  });
});

describe("failsafe scanning (#758)", () => {
  it("scanUnavailable marks the prompt unscanned but allowed", () => {
    const result = scanUnavailable("provider timeout");
    expect(result).toMatchObject({
      verdict: "allow",
      scanned: false,
      ruleIds: [],
    });
    expect(result.reasons[0]).toContain("provider timeout");
  });

  it("withFailSafe degrades a throwing provider to scanUnavailable", async () => {
    const bad: SafetyScanner = {
      scan: vi.fn().mockRejectedValue(new Error("provider exploded")),
    };
    const wrapped = withFailSafe(bad);
    const result = await wrapped.scan(baseInput);
    expect(result.verdict).toBe("allow");
    expect(result.scanned).toBe(false);
    expect(result.reasons[0]).toContain("provider exploded");
  });

  it("withFailSafe passes through healthy providers", async () => {
    const good: SafetyScanner = {
      scan: vi.fn().mockResolvedValue({ verdict: "queue", reasons: ["r"], ruleIds: ["x"], scanned: true }),
    };
    const result = await withFailSafe(good).scan(baseInput);
    expect(result.verdict).toBe("queue");
    expect(result.scanned).toBe(true);
  });

  it("withFailSafe(null) reports no scanner configured", async () => {
    const result = await withFailSafe(null).scan(baseInput);
    expect(result.scanned).toBe(false);
    expect(result.verdict).toBe("allow");
  });
});

describe("moderation state machine (#758)", () => {
  it("maps verdicts to review states", () => {
    expect(statusFromVerdict("allow", true)).toBe("none");
    expect(statusFromVerdict("queue", true)).toBe("pending");
    expect(statusFromVerdict("block", true)).toBe("rejected");
  });

  it("unscanned prompts stay none regardless of verdict", () => {
    expect(statusFromVerdict("queue", false)).toBe("none");
    expect(statusFromVerdict("block", false)).toBe("none");
  });

  it("only pending prompts can be overridden", () => {
    expect(canOverride("pending", "approve")).toBe(true);
    expect(canOverride("pending", "reject")).toBe(true);
    expect(canOverride("none", "approve")).toBe(false);
    expect(canOverride("approved", "approve")).toBe(false);
    expect(canOverride("rejected", "approve")).toBe(false);
  });

  it("validates reason code / action pairings", () => {
    expect(
      validateOverride({ status: "pending", action: "approve", reasonCode: "false_positive", actingAdmin: "GADMIN" }),
    ).toEqual({ ok: true });
    expect(
      validateOverride({ status: "pending", action: "reject", reasonCode: "false_positive", actingAdmin: "GADMIN" }),
    ).toEqual({ ok: false, error: expect.stringContaining("false_positive") });
    expect(
      validateOverride({
        status: "pending",
        action: "approve",
        reasonCode: "policy_violation_confirmed",
        actingAdmin: "GADMIN",
      }),
    ).toEqual({ ok: false, error: expect.stringContaining("policy_violation_confirmed") });
    expect(
      validateOverride({ status: "pending", action: "approve", reasonCode: "other", actingAdmin: "" }),
    ).toEqual({ ok: false, error: expect.stringContaining("actingAdmin") });
  });
});

describe("safetyScannerHook — indexer persistence (#758)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("persists the verdict and pending status", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({});
    vi.doMock("../models/Prompt", () => ({ default: { findOneAndUpdate } }));
    vi.doMock("../services/structuredLogger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

    const { applySafetyScan: hook } = await import("../services/safetyScannerHook.js");
    await hook("123", { title: "clean prompt", description: "nothing odd" });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { onChainId: "123" },
      {
        $set: expect.objectContaining({
          moderationStatus: "none",
          scannerVerdict: "allow",
        }),
      },
    );
  });

  it("queues a flagged prompt for review", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({});
    vi.doMock("../models/Prompt", () => ({ default: { findOneAndUpdate } }));
    vi.doMock("../services/structuredLogger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

const { applySafetyScan: hook } = await import("../services/safetyScannerHook.js");
    await hook("124", { title: "how to make a bomb" });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { onChainId: "124" },
      {
        $set: expect.objectContaining({
          moderationStatus: "pending",
          scannerVerdict: "queue",
          scannerRuleIds: ["violence"],
        }),
      },
    );
  });

  it("fails safe when persistence throws", async () => {
    const findOneAndUpdate = vi.fn().mockRejectedValue(new Error("db down"));
    vi.doMock("../models/Prompt", () => ({ default: { findOneAndUpdate } }));
    vi.doMock("../services/structuredLogger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

const { applySafetyScan: hook } = await import("../services/safetyScannerHook.js");
    await expect(hook("125", { title: "clean prompt" })).resolves.toBeUndefined();
  });
});
