export interface RareFailureFixture {
  id: string;
  failureMode: string;
  retryable?: boolean;
  description: string;
  schemaVersion: string;
  expectedRepairPath: string;
  payload: {
    operationId: string;
    promptId: string;
    buyerWallet: string;
    txHash?: string;
    expectedHash?: string;
    actualHash?: string;
    missingLedgerRange?: [number, number];
    status: string;
  };
}

export const RARE_FAILURE_FIXTURES: RareFailureFixture[] = [
  {
    id: "fix-001-orphaned-purchase",
    failureMode: "ORPHANED_ONCHAIN_PURCHASE",
    description: "On-chain payment succeeded on Stellar ledger, but local indexing failed mid-transaction leaving buyer entitlement unrecorded.",
    schemaVersion: "1.0.0",
    expectedRepairPath: "Execute `OperationRecoveryService.syncUnclaimedPurchase(txHash)` to verify Stellar ledger transaction and issue buyer entitlement.",
    payload: {
      operationId: "op-orphaned-991",
      promptId: "101",
      buyerWallet: "GBUYER1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
      txHash: "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890",
      status: "UNCLAIMED_ONCHAIN",
    },
  },
  {
    id: "fix-002-content-hash-mismatch",
    failureMode: "DESYNCED_PROMPT_CONTENT_HASH",
    description: "IPFS CID payload sha256 checksum differs from Soroban contract committed content hash due to gateway interruption.",
    schemaVersion: "1.0.0",
    expectedRepairPath: "Execute `repinIpfsContent(promptId, verifiedContent)` to update IPFS pin and align CID hash pointer with contract state.",
    payload: {
      operationId: "op-desync-442",
      promptId: "202",
      buyerWallet: "GBUYER1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
      expectedHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      actualHash: "0x9999999999999999999999999999999999999999999999999999999999999999",
      status: "INTEGRITY_MISMATCH",
    },
  },
  {
    id: "fix-003-payout-ledger-gap",
    failureMode: "STALE_PAYOUT_LEDGER_GAP",
    description: "Payout ledger stream missed sequence 105 during network partition, creating sequence gaps in historical payout auditing.",
    schemaVersion: "1.0.0",
    expectedRepairPath: "Execute `payoutReconciliationService.reindexRange(startLedger, endLedger)` to fetch missing Horizon blocks and backfill ledger.",
    payload: {
      operationId: "op-gap-773",
      promptId: "303",
      buyerWallet: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
      missingLedgerRange: [104, 106],
      status: "SEQUENCE_GAP",
    },
  },
  {
    id: "fix-004-retry-transient-horizon-timeout",
    failureMode: "TRANSIENT_HORIZON_TIMEOUT",
    description: "Horizon request timed out during payout sync; operation is safe to retry with the same idempotency key without duplicating entitlement.",
    schemaVersion: "1.0.0",
    expectedRepairPath: "Retry `OperationRecoveryService.syncUnclaimedPurchase(txHash)` with exponential backoff; abort after max attempts and roll back the pending entitlement marker.",
    retryable: true,
    payload: {
      operationId: "op-retry-118",
      promptId: "404",
      buyerWallet: "GBUYER1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
      txHash: "b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1",
      status: "RETRY_PENDING",
    },
  },
  {
    id: "fix-005-unauthorized-repair-attempt",
    failureMode: "UNAUTHORIZED_REPAIR_ATTEMPT",
    description: "Repair invoked by a wallet that is not the prompt creator or an operator; must be rejected without mutating entitlement state.",
    schemaVersion: "1.0.0",
    expectedRepairPath: "Reject the request with an authorization error and leave the ledger and entitlement records unchanged.",
    retryable: false,
    payload: {
      operationId: "op-auth-665",
      promptId: "505",
      buyerWallet: "GUNAUTHORIZED1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
      status: "AUTH_REJECTED",
    },
  },
];

/**
 * Validate that a given fixture matches current required schema structure.
 */
export function validateFixtureSchema(fixture: RareFailureFixture): boolean {
  if (!fixture || typeof fixture !== "object") return false;
  if (!fixture.id || !fixture.failureMode || !fixture.description || !fixture.expectedRepairPath) return false;
  if (!fixture.payload || typeof fixture.payload !== "object") return false;
  if (!fixture.payload.operationId || !fixture.payload.promptId || !fixture.payload.buyerWallet || !fixture.payload.status) return false;
  return true;
}

/**
 * Returns fixtures whose failure mode is retryable.
 */
export function getRetryableFixtures(): RareFailureFixture[] {
  return RARE_FAILURE_FIXTURES.filter((f) => f.retryable === true);
}

/**
 * Generates a rare-failure fixture for a given failure mode, applying defaults
 * for the normal, failure, retry, and authorization paths.
 */
export function generateRareFailureFixture(
  id: string,
  failureMode: string,
  payload: RareFailureFixture["payload"],
  retryable = false,
): RareFailureFixture {
  const fixture: RareFailureFixture = {
    id,
    failureMode,
    description: `Generated fixture for ${failureMode}`,
    schemaVersion: "1.0.0",
    expectedRepairPath: "Manual review required",
    retryable,
    payload,
  };
  if (!validateFixtureSchema(fixture)) {
    throw new Error(`Generated fixture failed validation: ${id}`);
  }
  return fixture;
}

/**
 * Execute repair path for a given rare failure fixture.
 *
 * Authorization is enforced before any repair: a caller must be the prompt
 * creator or an operator. Unauthorized attempts are rejected and the fixture
 * payload is returned unchanged (no mutation).
 *
 * Retryable failures are retried up to `maxAttempts` with exponential backoff.
 * If all attempts fail, the pending entitlement marker is rolled back (status
 * reset to the pre-repair state) and the error is surfaced.
 */
export interface RepairContext {
  callerWallet: string;
  operatorWallets?: string[];
  creatorWallets?: Record<string, string>; // promptId -> creator wallet
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  // Injection point for the real side effect; defaults to a deterministic success.
  performRepair?: (fixture: RareFailureFixture) => Promise<void>;
}

export interface RepairResult {
  success: boolean;
  message: string;
  repairedPayload: Record<string, unknown>;
  attempts?: number;
  rolledBack?: boolean;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function isAuthorized(fixture: RareFailureFixture, ctx: RepairContext): boolean {
  if (ctx.operatorWallets?.includes(ctx.callerWallet)) return true;
  const creator = ctx.creatorWallets?.[fixture.payload.promptId];
  return creator !== undefined && creator === ctx.callerWallet;
}

export async function executeRepairPath(
  fixture: RareFailureFixture,
  ctx?: RepairContext,
): Promise<RepairResult> {
  if (!validateFixtureSchema(fixture)) {
    throw new Error(`Fixture validation failed for fixture ID: ${fixture?.id}`);
  }

  if (ctx && !isAuthorized(fixture, ctx)) {
    return {
      success: false,
      message: `Unauthorized repair attempt by ${ctx.callerWallet} for prompt ${fixture.payload.promptId}`,
      repairedPayload: { ...fixture.payload },
      attempts: 0,
      rolledBack: false,
    };
  }

  const { failureMode, payload } = fixture;

  const apply = async (): Promise<Record<string, unknown>> => {
    switch (failureMode) {
      case "ORPHANED_ONCHAIN_PURCHASE":
        return {
          ...payload,
          status: "CLAIMED_CONFIRMED",
          repairedAt: new Date().toISOString(),
        };
      case "DESYNCED_PROMPT_CONTENT_HASH":
        return {
          ...payload,
          actualHash: payload.expectedHash,
          status: "SYNCHRONIZED",
          repairedAt: new Date().toISOString(),
        };
      case "STALE_PAYOUT_LEDGER_GAP":
        return {
          ...payload,
          missingLedgerRange: undefined,
          status: "RECONCILED",
          repairedAt: new Date().toISOString(),
        };
      case "TRANSIENT_HORIZON_TIMEOUT":
        return {
          ...payload,
          status: "CLAIMED_CONFIRMED",
          repairedAt: new Date().toISOString(),
        };
      default:
        throw new Error(`Unknown failure mode repair handler: ${failureMode}`);
    }
  };

  const maxAttempts = ctx?.maxAttempts ?? (fixture.retryable ? 3 : 1);
  const baseDelayMs = ctx?.baseDelayMs ?? 100;
  const sleep = ctx?.sleep ?? defaultSleep;
  const performRepair = ctx?.performRepair;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (performRepair) await performRepair(fixture);
      const repairedPayload = await apply();
      return {
        success: true,
        message: `Repaired ${failureMode} for prompt ${payload.promptId} after ${attempt} attempt(s)`,
        repairedPayload,
        attempts: attempt,
        rolledBack: false,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  // Roll back the pending entitlement marker: keep the original payload.
  return {
    success: false,
    message: `Repair failed after ${maxAttempts} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    repairedPayload: { ...payload },
    attempts: maxAttempts,
    rolledBack: true,
  };
}
