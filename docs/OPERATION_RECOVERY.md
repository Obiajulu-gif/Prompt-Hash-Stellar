# Operation Recovery Framework (Issue #831)

## Overview
The Operation Recovery Framework provides deterministic checkpointing and safe recovery flows for multi-step marketplace operations in Prompt Hash Stellar (prompt purchases, mints, escrow releases, and payouts).

## Multi-Step State Flow
Each operation moves through deterministic states:
1. `INITIALIZED`: Idempotency token registered, inputs validated.
2. `PREVALIDATED`: Balances, entitlements, and prompt eligibility checked.
3. `ONCHAIN_SUBMITTED`: Transaction broadcast to Soroban/Stellar network with recorded `txHash`.
4. `CONFIRMED`: On-chain confirmation received, database state finalized.
5. `RECOVERABLE`: Interrupted operation evaluated; safe to resume from checkpoint without duplicate side effects.
6. `FAILED` / `ABANDONED`: Terminal failure with automated rollback or maintainer manual review.

## Maintainer Diagnostics
Maintainers can detect stuck or orphaned operations using:
```typescript
import { OperationRecoveryService } from "../services/operationRecoveryService";

// Find operations stuck for more than 30 minutes
const stuckOps = await OperationRecoveryService.findStuckOperations(30);

// Resolve with maintainer action
await OperationRecoveryService.forceResolveOperation(
  operationId,
  "MARK_CONFIRMED",
  maintainerId,
  "Verified on-chain via block explorer"
);
```
