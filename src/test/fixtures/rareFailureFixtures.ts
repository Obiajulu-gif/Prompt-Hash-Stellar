export interface RareFailureFixture {
  id: string;
  failureMode: string;
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
 * Execute simulated repair path for a given rare failure fixture.
 */
export async function executeRepairPath(fixture: RareFailureFixture): Promise<{ success: boolean; message: string; repairedPayload: Record<string, unknown> }> {
  if (!validateFixtureSchema(fixture)) {
    throw new Error(`Fixture validation failed for fixture ID: ${fixture?.id}`);
  }

  const { failureMode, payload } = fixture;

  switch (failureMode) {
    case "ORPHANED_ONCHAIN_PURCHASE":
      return {
        success: true,
        message: `Successfully verified Stellar tx ${payload.txHash} and synced entitlement for ${payload.buyerWallet}`,
        repairedPayload: {
          ...payload,
          status: "CLAIMED_CONFIRMED",
          repairedAt: new Date().toISOString(),
        },
      };

    case "DESYNCED_PROMPT_CONTENT_HASH":
      return {
        success: true,
        message: `Re-pinned IPFS payload for prompt ${payload.promptId} matching expected contract hash ${payload.expectedHash}`,
        repairedPayload: {
          ...payload,
          actualHash: payload.expectedHash,
          status: "SYNCHRONIZED",
          repairedAt: new Date().toISOString(),
        },
      };

    case "STALE_PAYOUT_LEDGER_GAP":
      return {
        success: true,
        message: `Successfully re-indexed missing ledger range ${payload.missingLedgerRange?.join("-")} from Horizon archive`,
        repairedPayload: {
          ...payload,
          missingLedgerRange: undefined,
          status: "RECONCILED",
          repairedAt: new Date().toISOString(),
        },
      };

    default:
      throw new Error(`Unknown failure mode repair handler: ${failureMode}`);
  }
}
