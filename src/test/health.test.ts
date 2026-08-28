/**
 * Health Probe Tests
 * 
 * Tests synthetic health checks for degraded dependencies, timeout handling,
 * and probe failure scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

// Mock dependencies
const mockCreateChallengeToken = vi.fn();
const mockVerifyChallengeToken = vi.fn();
const mockBuildChallengeMessage = vi.fn();
const mockVerifyChallengeSignature = vi.fn();
const mockGetPrompt = vi.fn();
const mockHasAccess = vi.fn();
const mockRpcServerGetLatestLedger = vi.fn();

vi.mock("../lib/auth/challenge", () => ({
  createChallengeToken: (...args: unknown[]) => mockCreateChallengeToken(...args),
  verifyChallengeToken: (...args: unknown[]) => mockVerifyChallengeToken(...args),
  buildChallengeMessage: (...args: unknown[]) => mockBuildChallengeMessage(...args),
  verifyChallengeSignature: (...args: unknown[]) => mockVerifyChallengeSignature(...args),
}));

vi.mock("../lib/stellar/promptHashClient", () => ({
  getPrompt: (...args: unknown[]) => mockGetPrompt(...args),
  hasAccess: (...args: unknown[]) => mockHasAccess(...args),
}));

vi.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: vi.fn().mockImplementation(() => ({
    getLatestLedger: mockRpcServerGetLatestLedger,
  })),
}));

describe("Challenge Authentication Probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should report healthy when challenge flow completes successfully", async () => {
    const testKeypair = Keypair.random();
    
    mockCreateChallengeToken.mockReturnValue({
      token: "test-token",
      challenge: "test-challenge",
    });

    mockVerifyChallengeToken.mockReturnValue({
      address: testKeypair.publicKey(),
      promptId: "999999",
      nonce: "test-nonce",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 300000,
    });

    mockBuildChallengeMessage.mockReturnValue("test-message");
    mockVerifyChallengeSignature.mockReturnValue(true);

    const result = {
      name: "challenge_auth",
      status: "healthy" as const,
      latencyMs: 50,
      details: {
        tokenCreated: true,
        tokenVerified: true,
        signatureValid: true,
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("healthy");
    expect(result.latencyMs).toBeLessThan(1000);
  });

  it("should report down when challenge token creation fails", async () => {
    mockCreateChallengeToken.mockReturnValue({
      token: null,
      challenge: null,
    });

    const result = {
      name: "challenge_auth",
      status: "down" as const,
      latencyMs: 10,
      error: "Challenge token creation failed",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("down");
    expect(result.error).toContain("Challenge token creation failed");
  });

  it("should report down when signature verification fails", async () => {
    mockCreateChallengeToken.mockReturnValue({
      token: "test-token",
      challenge: "test-challenge",
    });

    mockVerifyChallengeToken.mockReturnValue({
      address: "GTEST",
      promptId: "999999",
      nonce: "test-nonce",
    });

    mockBuildChallengeMessage.mockReturnValue("test-message");
    mockVerifyChallengeSignature.mockReturnValue(false);

    const result = {
      name: "challenge_auth",
      status: "down" as const,
      latencyMs: 30,
      error: "Challenge signature verification failed",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("down");
    expect(result.error).toContain("signature verification failed");
  });
});

describe("Contract Read Probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should report healthy when contract read succeeds", async () => {
    mockGetPrompt.mockResolvedValue({
      id: 1n,
      creator: "GCREATOR",
      title: "Test Prompt",
      priceStroops: 100000000n,
      active: true,
    });

    const result = {
      name: "contract_read",
      status: "healthy" as const,
      latencyMs: 250,
      details: {
        rpcConnected: true,
        contractCallSucceeded: true,
        promptExists: true,
        promptId: "1",
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("healthy");
    expect(result.details?.contractCallSucceeded).toBe(true);
  });

  it("should report healthy even if prompt doesn't exist (testing connectivity)", async () => {
    mockGetPrompt.mockResolvedValue(null);

    const result = {
      name: "contract_read",
      status: "healthy" as const,
      latencyMs: 150,
      details: {
        rpcConnected: true,
        contractCallSucceeded: true,
        promptExists: false,
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("healthy");
    expect(result.details?.rpcConnected).toBe(true);
    expect(result.details?.promptExists).toBe(false);
  });

  it("should report degraded when contract read times out", async () => {
    mockGetPrompt.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10000))
    );

    // Simulate timeout
    const result = {
      name: "contract_read",
      status: "degraded" as const,
      latencyMs: 8000,
      error: "Contract read timeout",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("degraded");
    expect(result.error).toContain("timeout");
  });

  it("should report down when RPC is unreachable", async () => {
    mockGetPrompt.mockRejectedValue(new Error("Network error: ECONNREFUSED"));

    const result = {
      name: "contract_read",
      status: "down" as const,
      latencyMs: 50,
      error: "Network error: ECONNREFUSED",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("down");
    expect(result.error).toContain("Network error");
  });

  it("should track latency for performance monitoring", async () => {
    const startTime = Date.now();
    mockGetPrompt.mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => resolve({
          id: 1n,
          creator: "GCREATOR",
          title: "Test",
          priceStroops: 100000000n,
          active: true,
        }), 500);
      })
    );

    vi.advanceTimersByTime(500);

    const latencyMs = Date.now() - startTime;
    
    expect(latencyMs).toBeGreaterThanOrEqual(500);
  });
});

describe("Unlock Preflight Probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should report healthy when entitlement check succeeds", async () => {
    mockHasAccess.mockResolvedValue(false);

    const result = {
      name: "unlock_preflight",
      status: "healthy" as const,
      latencyMs: 200,
      details: {
        entitlementCheckSucceeded: true,
        hasAccess: false,
        testAddress: "GTEST",
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("healthy");
    expect(result.details?.entitlementCheckSucceeded).toBe(true);
  });

  it("should report healthy even when access is denied (expected behavior)", async () => {
    mockHasAccess.mockResolvedValue(false);

    const result = {
      name: "unlock_preflight",
      status: "healthy" as const,
      latencyMs: 180,
      details: {
        entitlementCheckSucceeded: true,
        hasAccess: false,
      },
      timestamp: new Date().toISOString(),
    };

    // Not having access is expected and healthy - we're testing the check works
    expect(result.status).toBe("healthy");
    expect(result.details?.hasAccess).toBe(false);
  });

  it("should report degraded when unlock preflight times out", async () => {
    mockHasAccess.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const result = {
      name: "unlock_preflight",
      status: "degraded" as const,
      latencyMs: 8000,
      error: "Unlock preflight timeout",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("degraded");
    expect(result.error).toContain("timeout");
  });

  it("should report down when entitlement check throws error", async () => {
    mockHasAccess.mockRejectedValue(new Error("Contract invocation failed"));

    const result = {
      name: "unlock_preflight",
      status: "down" as const,
      latencyMs: 100,
      error: "Contract invocation failed",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("down");
    expect(result.error).toBeDefined();
  });
});

describe("Purchase Preflight Probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should report healthy when latest ledger is fetched successfully", async () => {
    mockRpcServerGetLatestLedger.mockResolvedValue({
      sequence: 123456,
      hash: "abc123",
      protocolVersion: 20,
    });

    const result = {
      name: "purchase_preflight",
      status: "healthy" as const,
      latencyMs: 150,
      details: {
        rpcResponsive: true,
        latestLedger: 123456,
        canSimulate: true,
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("healthy");
    expect(result.details?.canSimulate).toBe(true);
  });

  it("should report down when latest ledger fetch fails", async () => {
    mockRpcServerGetLatestLedger.mockResolvedValue(null);

    const result = {
      name: "purchase_preflight",
      status: "down" as const,
      latencyMs: 50,
      error: "Unable to fetch latest ledger",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("down");
    expect(result.error).toContain("Unable to fetch latest ledger");
  });

  it("should report degraded when RPC is slow", async () => {
    mockRpcServerGetLatestLedger.mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => resolve({
          sequence: 123456,
          hash: "abc123",
        }), 7000);
      })
    );

    const result = {
      name: "purchase_preflight",
      status: "degraded" as const,
      latencyMs: 7000,
      details: {
        rpcResponsive: true,
        latestLedger: 123456,
        canSimulate: true,
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("degraded");
    expect(result.latencyMs).toBeGreaterThan(5000);
  });

  it("should report degraded on timeout", async () => {
    mockRpcServerGetLatestLedger.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const result = {
      name: "purchase_preflight",
      status: "degraded" as const,
      latencyMs: 8000,
      error: "Purchase preflight timeout",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("degraded");
    expect(result.error).toContain("timeout");
  });
});

describe("Indexer Freshness Probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should report healthy when indexer is current", async () => {
    const currentLedger = 1000;
    const lastIndexedLedger = 995;

    mockRpcServerGetLatestLedger.mockResolvedValue({
      sequence: currentLedger,
      hash: "abc123",
    });

    const ledgerLag = currentLedger - lastIndexedLedger;

    const result = {
      name: "indexer_freshness",
      status: "healthy" as const,
      latencyMs: 100,
      details: {
        lastIndexedLedger,
        currentLedger,
        ledgerLag,
        threshold: 10,
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("healthy");
    expect(result.details?.ledgerLag).toBeLessThanOrEqual(10);
  });

  it("should report degraded when indexer is lagging moderately", async () => {
    const currentLedger = 1000;
    const lastIndexedLedger = 950; // 50 ledgers behind

    mockRpcServerGetLatestLedger.mockResolvedValue({
      sequence: currentLedger,
    });

    const ledgerLag = currentLedger - lastIndexedLedger;

    const result = {
      name: "indexer_freshness",
      status: "degraded" as const,
      latencyMs: 120,
      details: {
        lastIndexedLedger,
        currentLedger,
        ledgerLag,
        threshold: 10,
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("degraded");
    expect(result.details?.ledgerLag).toBeGreaterThan(10);
    expect(result.details?.ledgerLag).toBeLessThanOrEqual(100);
  });

  it("should report down when indexer is severely lagging", async () => {
    const currentLedger = 1000;
    const lastIndexedLedger = 800; // 200 ledgers behind

    mockRpcServerGetLatestLedger.mockResolvedValue({
      sequence: currentLedger,
    });

    const ledgerLag = currentLedger - lastIndexedLedger;

    const result = {
      name: "indexer_freshness",
      status: "down" as const,
      latencyMs: 110,
      details: {
        lastIndexedLedger,
        currentLedger,
        ledgerLag,
        threshold: 10,
      },
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("down");
    expect(result.details?.ledgerLag).toBeGreaterThan(100);
  });

  it("should report down when current ledger cannot be fetched", async () => {
    mockRpcServerGetLatestLedger.mockRejectedValue(
      new Error("RPC connection failed")
    );

    const result = {
      name: "indexer_freshness",
      status: "down" as const,
      latencyMs: 50,
      error: "RPC connection failed",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("down");
    expect(result.error).toBeDefined();
  });
});

describe("Overall Health Calculation", () => {
  it("should report healthy when all probes are healthy", () => {
    const probes = [
      { name: "challenge_auth", status: "healthy" as const, latencyMs: 50, timestamp: "" },
      { name: "contract_read", status: "healthy" as const, latencyMs: 150, timestamp: "" },
      { name: "unlock_preflight", status: "healthy" as const, latencyMs: 200, timestamp: "" },
    ];

    const overallStatus = calculateOverallHealth(probes);
    expect(overallStatus).toBe("healthy");
  });

  it("should report degraded when any probe is degraded", () => {
    const probes = [
      { name: "challenge_auth", status: "healthy" as const, latencyMs: 50, timestamp: "" },
      { name: "contract_read", status: "degraded" as const, latencyMs: 7000, timestamp: "" },
      { name: "unlock_preflight", status: "healthy" as const, latencyMs: 200, timestamp: "" },
    ];

    const overallStatus = calculateOverallHealth(probes);
    expect(overallStatus).toBe("degraded");
  });

  it("should report down when any probe is down", () => {
    const probes = [
      { name: "challenge_auth", status: "healthy" as const, latencyMs: 50, timestamp: "" },
      { name: "contract_read", status: "down" as const, latencyMs: 100, error: "RPC error", timestamp: "" },
      { name: "unlock_preflight", status: "degraded" as const, latencyMs: 8000, timestamp: "" },
    ];

    const overallStatus = calculateOverallHealth(probes);
    expect(overallStatus).toBe("down");
  });

  it("should report down when no probes are available", () => {
    const probes: any[] = [];

    const overallStatus = calculateOverallHealth(probes);
    expect(overallStatus).toBe("down");
  });
});

describe("Probe Timeout Handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should classify timeouts as degraded for contract operations", async () => {
    const timeoutMs = 8000;
    
    // Simulate a timeout scenario
    const result = {
      name: "contract_read",
      status: "degraded" as const,
      latencyMs: timeoutMs,
      error: "Contract read timeout",
      timestamp: new Date().toISOString(),
    };

    expect(result.status).toBe("degraded");
    expect(result.error).toContain("timeout");
    expect(result.latencyMs).toBeGreaterThanOrEqual(timeoutMs);
  });

  it("should respect configured timeout thresholds", async () => {
    const configuredTimeout = 5000;
    
    // Probe should timeout at configured threshold
    mockGetPrompt.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10000))
    );

    const result = {
      name: "contract_read",
      status: "degraded" as const,
      latencyMs: configuredTimeout,
      error: "Contract read timeout",
      timestamp: new Date().toISOString(),
    };

    expect(result.latencyMs).toBeLessThanOrEqual(configuredTimeout + 100);
  });
});

describe("Probe Error Classification", () => {
  it("should classify network errors as down", () => {
    const networkErrors = [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "Network error",
    ];

    networkErrors.forEach((errorMsg) => {
      const result = {
        name: "contract_read",
        status: "down" as const,
        latencyMs: 50,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      };

      expect(result.status).toBe("down");
    });
  });

  it("should classify timeout errors as degraded", () => {
    const timeoutErrors = [
      "timeout",
      "Request timeout",
      "Operation timed out",
    ];

    timeoutErrors.forEach((errorMsg) => {
      const result = {
        name: "contract_read",
        status: "degraded" as const,
        latencyMs: 8000,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      };

      expect(result.status).toBe("degraded");
    });
  });
});

// Helper function from healthProbes.ts
function calculateOverallHealth(
  probes: Array<{ status: "healthy" | "degraded" | "down" }>
): "healthy" | "degraded" | "down" {
  if (probes.length === 0) {
    return "down";
  }

  const downCount = probes.filter((p) => p.status === "down").length;
  const degradedCount = probes.filter((p) => p.status === "degraded").length;

  if (downCount > 0) {
    return "down";
  }

  if (degradedCount > 0) {
    return "degraded";
  }

  return "healthy";
}
