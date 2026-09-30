# Design Proposals: Escrow, Replay Protection, Finality, and Invariants

This document proposes designs for issues #420, #421, #422, and #423, addressing escrow-backed settlements, replay-resistant challenges, finality-aware indexing, and property-based payout invariants.

## Issue #420: Escrow-Backed Dispute Refunds

### Current State
- Purchases directly release funds to creators and fee wallet
- `resolve_dispute` attempts to refund from potentially unfunded contract balance
- No explicit dispute window or settlement states

### Proposed Design

#### Settlement State Machine
```
Pending → (expires → Refundable) | (approved → Releasable)
Refundable → Refunded (revokes access)
Releasable → Released (immutable, no refund possible)
```

#### Storage Model
Add to `storage.rs`:
```rust
struct PurchaseEscrow {
    id: [u8; 32],              // unique purchase id
    amount: i128,              // total purchase amount (in stroops)
    asset: Asset,              // payment asset
    buyer: Address,            // purchaser
    creator: Address,          // content creator
    disputed_at: Option<u64>,  // dispute timestamp if disputed
    settled_at: Option<u64>,   // settlement timestamp
    state: SettlementState,    // pending, releasable, refundable, released, refunded
}

enum SettlementState {
    Pending(u64),      // expires_at (unix seconds)
    Releasable,
    Refundable(u64),   // refund_deadline
    Released,
    Refunded,
}
```

#### Transaction Flow
1. **Purchase**: Transfer funds to contract escrow, store PurchaseEscrow in Pending state
2. **Release** (post-dispute window): Atomic update to Released state + payout to creator/platform
3. **Dispute**: Transition Pending → Refundable, begin dispute window (7 days default)
4. **Refund** (post-dispute approval): Atomic update to Refunded state + transfer to buyer + revoke access

#### Events
```rust
PurchaseCreated(purchase_id, buyer, amount, dispute_window_seconds)
PurchaseDisputed(purchase_id, timestamp)
PurchaseReleased(purchase_id, creator_amount, platform_amount, timestamp)
PurchaseRefunded(purchase_id, refund_amount, timestamp)
```

#### Migration & Compatibility
- New purchases use escrow
- Existing purchases (pre-escrow) treated as "already released" (legacy mode)
- Bump contract version, reject old invocations

### Test Strategy
- Unit tests: state transitions, invalid paths, idempotency
- Invariant tests: double-release rejection, double-refund rejection, insufficient custody
- Edge cases: timeout expiry, pause during settlement, rounding, concurrent refund/release

---

## Issue #421: Property-Based Payout Invariants

### Current State
- `execute_buy` combines splits, referrals, vouchers, tips, and fees
- Example-based tests insufficient to prove fund conservation

### Proposed Design

#### Invariants to Assert
1. **Value Conservation**: `sum(all_transfers) == charged_amount`
2. **Creator Non-Negative**: `creator_payout >= 0` (always, even after splits/tips)
3. **Bounded Fees**: `0 <= platform_fee <= charged_amount * max_fee_bps / 10000`
4. **Voucher One-Time**: `(used_voucher_count) <= 1` per voucher per buyer
5. **Atomic Rollback**: On failure, all balances/counts unchanged

#### Property Generator Strategy
```typescript
// Generators for Propttest/hypothesis-style property testing
generatePrice(): i128                    // valid Soroban i128 range
generatePaymentAmount(): i128            // >= price
generateFeeBps(): u16                    // 0-10000
generateSplits(): Vec<(Address, u16)>   // sum <= 10000 bps
generateReferral(): Option<Address>      // optional referrer
generateVoucher(): Option<VoucherId>     // optional, tracked 1x per buyer
generateTip(): i128                      // 0..price

// Combined purchase case
generateValidPurchase(): PurchaseCase
generateInvalidPurchase(): InvalidCase   // should reject atomically
```

#### Test Execution
- Run 10,000+ generated cases deterministically in CI
- Print reproducible seed on failure (allows re-running exact failure)
- Assert all transfers sum exactly, all storage unchanged on failure

#### Implementation
- Use `proptest` crate for Rust property testing
- Wrap contract methods with mock asset tracking
- Assert balance deltas match expected distribution

### Test Strategy
- Property-based fuzzing of splits/referrals/vouchers/tips combinations
- Regression seeds for every discovered failure
- Pre-purchase and post-purchase balance assertions
- Concurrent purchase invariants (no cross-purchase leaks)

---

## Issue #422: Replay-Resistant Wallet Challenges

### Current State
- Token-based challenge has only short lifetime (minutes)
- Vulnerable to replay across prompts, deployments, networks
- No explicit domain separation

### Proposed Design

#### Challenge Binding
Each challenge binds to:
- `wallet_address`: Stellar public key
- `prompt_id`: [u8; 32] hash of prompt content
- `action`: "unlock" | "purchase" | etc.
- `network_passphrase`: Stellar testnet/public
- `contract_id`: Soroban contract address
- `origin`: HTTP origin (for web clients)
- `issued_at`: Unix seconds (for replay window)
- `expires_at`: Unix seconds (TTL, typically 5 min)

#### Nonce Protocol
```
1. Client requests challenge:
   POST /api/auth/challenge
   body: { wallet, prompt_id, action, origin }

2. Server generates:
   - nonce = random([u8; 32])
   - challenge_hash = blake3(nonce || domain_struct)
   - persists (challenge_hash, expires_at, claimed=false) to Redis
   - returns plaintext challenge (nonce + domain) to client

3. Client signs: signature = stellar_sign(challenge)

4. Client submits unlock:
   POST /api/prompts/:id/unlock
   body: { signature, challenge }

5. Server verifies:
   - Parse challenge, recompute hash, lookup in Redis
   - Assert not claimed, not expired
   - Verify signature over plaintext challenge
   - Atomically set claimed=true, return access token
   - On concurrent requests, exactly one succeeds (optimistic locking)
```

#### Error Handling
- Redis unavailable → fail closed (no access granted)
- Signature invalid → reject
- Challenge expired → reject
- Challenge already claimed → reject
- Domain mismatch → reject

#### Secret Rotation
- When rotating signing keys, accept old+new signatures for grace period (1 hour)
- After grace, only new key signatures valid
- Clients retry with fresh challenge if rotation detected

#### Clock Skew
- Accept ±60s skew in issued_at/expires_at timestamps

### Test Strategy
- Replay: same signature on different prompts → rejected
- Substitution: signature valid for prompt A but applied to prompt B → rejected
- Expiry boundaries: 1 second before/after expiration
- Malformed signatures: truncated, wrong format → rejected
- Rotation grace period: old vs new key during transition
- Race conditions: concurrent use of single challenge (one succeeds, others fail)
- Redis unavailability: all requests fail closed

---

## Issue #423: Finality-Aware Soroban Event Ingestion

### Current State
- Index consumes Soroban events as they appear
- No tracking of ledger finality
- Vulnerable to reorgs, missing events on RPC pagination changes
- Cannot safely grant access or publish stale catalog state

### Proposed Design

#### Checkpoint Model Enhancement
```rust
struct IndexerCheckpoint {
    network: String,                    // testnet | public
    contract_id: String,
    ledger_sequence: u32,               // last ingested ledger
    transaction_hash: String,           // last transaction
    event_index: u32,                   // position in transaction
    ledger_hash: String,                // blake3(ledger header)
    finality_status: FinalityStatus,   // tentative | candidate | final
}

enum FinalityStatus {
    Tentative(confirmed_count: u32),   // seen in N ledgers, N < threshold
    Candidate(confirmed_count: u32),   // seen in N ledgers, N >= threshold (15+)
    Final,                             // past closure boundary (N+256)
}
```

#### Ingestion Phases
1. **Provisional Ingestion** (FinalityStatus::Tentative)
   - Consume events from RPC, store checkpoint
   - Mark all derived projections (Purchase, Access) as provisional
   - Do NOT grant access, do NOT publish catalog
   
2. **Candidate Finalization** (FinalityStatus::Candidate, 15+ confirmations)
   - Batch update projections to candidate state
   - Begin publishing to catalog (read-only, may rewind)
   
3. **Final Commitment** (FinalityStatus::Final, past closure)
   - Mark all as final
   - Safely grant access, finalize catalog entries

#### Fork Recovery
```
On ledger reorg detection (hash mismatch):
1. Detect fork point (first ledger where hash differs)
2. Rewind checkpoint to fork point
3. Mark all provisional/candidate records > fork point as orphaned
4. Replay canonical chain from fork point
5. Atomic commit of rewound checkpoint + replayed records
```

#### Reconciliation Command
```
$ ./reIndexFromLedger --from-ledger 12345 --mode reconcile
- Fetches [ledger..current] from RPC
- Compares hashes against checkpoint history
- Detects gaps, duplicates, orphaned events
- Reports findings, recommends action
- Optionally dry-run replay
```

#### Metrics & Observability
- `indexer_lag_seconds`: seconds behind head
- `indexer_gap_events_total`: count of missing events
- `indexer_fork_depth`: deepest detected fork
- `indexer_replay_count`: total replays across all forks
- `indexer_poisoned_events`: events failing replay (never match)

### Test Strategy
- **Idempotency**: Reprocess same ledger range → same state
- **Fork Simulation**: Inject synthetic fork, verify rewind + replay
- **Atomic Commits**: Checkpoint updates paired with projection updates (no orphans)
- **Concurrent Access**: Access checks during provisional/candidate/final transitions
- **Race Conditions**: Concurrent reIndexFromLedger + normal ingestion
- **Gap Detection**: Simulated RPC pagination boundaries
- **Poisoned Events**: Events that fail validation on replay (alert & skip)

---

## Integration Strategy

### Sequencing
1. **Phase 1**: Implement #422 (Replay Protection) — orthogonal, enables auth tests
2. **Phase 2**: Implement #423 (Finality) — enables safe access granting
3. **Phase 3**: Implement #420 (Escrow) — settlement model, uses #423 for safety
4. **Phase 4**: Implement #421 (Invariants) — validates #420 correctness

### Cross-Issue Dependencies
- #420 → #423: Escrow requires finality guarantee before granting access
- #420 → #421: Payout invariants prove escrow state transitions preserve funds
- #422 → all: Replay protection required before any access grant

### Shared Infrastructure
- Checkpoint/finality model for both #423 and #420 (one source of truth for settlement)
- Property test framework for #421 benefits #420 validation
- Mock asset tracking for both #421 and unit tests

### Migration & Rollback
- Old purchases pre-escrow: treat as already-released legacy
- Toggle escrow on/off via contract version (not runtime flag)
- Finality-aware indexing: existing events replayed under new rules, no state loss

---

## Questions for Maintainers

1. **Issue #420**: Is 7-day dispute window correct? Should it be configurable?
2. **Issue #421**: Is 10,000 test cases sufficient, or should we target higher coverage?
3. **Issue #422**: Should we support multiple key versions, or rotate atomically?
4. **Issue #423**: Is 15-ledger confirmation threshold (with 256 closure) aligned with Stellar consensus?
5. **All**: Should we implement in one PR or four separate PRs after design approval?

---

## Implementation Effort Estimate

| Issue | Scope | Est. PRs | Est. Commits |
|-------|-------|----------|--------------|
| #420 | Escrow state machine, events, migration | 1-2 | 8-10 |
| #421 | Property generators, invariants, tests | 1 | 6-8 |
| #422 | Challenge binding, nonce protocol, tests | 1 | 5-7 |
| #423 | Checkpoint model, phases, reorg logic | 1-2 | 8-10 |

**Total: ~4-6 PRs, ~30-40 commits, estimated 4-6 week project with review cycles**

---

# Design Proposals: Index Pagination, Catalog Drift Repair, Checked Counters & Event Quarantine (#651, #652, #653, #654)

## Issue #651: Cursor Pagination for Creator and Buyer Ownership Indexes

### Current State
- `get_prompts_by_creator` and `get_prompts_by_buyer` return unpaginated vectors, leading to unbound gas/resource consumption as user activity scales.
- `get_all_prompts_paginated` exists but creator and buyer lookups lack cursor-based endpoints.

### Proposed Design
- Introduce `IndexType::Buyer = 5` to `pagination.rs`.
- Add `get_prompts_by_creator_paginated(creator, cursor, limit)` and `get_prompts_by_buyer_paginated(buyer, cursor, limit)` to `PromptHashTrait` and `PromptHashContract`.
- Cursors are 9-byte raw serialized byte buffers encoding big-endian last item ID and 1-byte index type discriminant.
- TypeScript client bindings `contractGetPromptsByCreatorPaginated` and `contractGetPromptsByBuyerPaginated` in `src/lib/stellar/contractMethods.ts`.

### Compatibility & Rollout
- Fully backward compatible: legacy `get_prompts_by_creator` and `get_prompts_by_buyer` retained.
- Clients can adopt paginated methods incrementally.

### Failure Handling & Limits
- Bounded by `MAX_PAGE_SIZE = 50`. Exceeding limits clamps to maximum page size.
- Invalid or corrupted cursors fail deterministically with `Error::InvalidCursor`.

### Test Strategy
- Multi-page iteration tests, empty index bounds, single-item pages, limit clamps, and invalid cursor rejection.

---

## Issue #652: Detect and Repair Drift Across Catalog Secondary Indexes

### Current State
- Secondary indexes (`AllPrompts`, `ActivePrompts`, `CategoryPrompts`, `TagPrompts`, `CreatorPrompts`) can diverge from canonical `Prompt` storage due to partial writes, historical bugs, or TTL differences.

### Proposed Design
- Implement `verify_catalog_indexes(start_id, batch_size) -> IndexDriftReport`: Read-only, permissionless scan returning drift counts.
- Implement `repair_catalog_indexes(admin, start_id, batch_size, dry_run) -> IndexRepairSummary`: Admin-authorized repair with dry-run support, batch bounds, and resumable pagination.
- Emit `CatalogIndexesRepaired` event for auditing.
- Make multi-index mutations in `create_prompt`, `revise_listing`, and status transitions atomic and idempotent.

### Compatibility & Rollout
- Safe for live operation. Operators run verification first, then dry-run repair, followed by live repair in bounded batches.

### Test Strategy
- Fault injection of missing/stale entries in All, Active, Category, Tag, and Creator indexes.
- Verification of dry-run vs live repair semantics.
- Idempotency test proving healthy indexes require 0 repairs on re-run.

---

## Issue #653: Replace Saturating Marketplace Counters with Checked Invariant Enforcement

### Current State
- `prompt.sales_count.saturating_sub(1)` and unchecked arithmetic allowed silent underflow and state inconsistencies during dispute resolutions or refunds.

### Proposed Design
- Replace all saturating operations on counters with `checked_sub(1).ok_or(Error::ArithmeticOverflow)?`.
- Enforce strict settlement and dispute status checks (`DisputeStatus::Open` and `SettlementStatus::Pending`), rejecting double-refund attempts with `Error::DisputeResolved` or `Error::SettlementAlreadyFinalized`.
- Add admin-authorized `reconcile_sales_counter(admin, prompt_id)` to reconcile historical clamped records.
- Emit `SalesCounterReconciled` audit events.

### Compatibility & Rollout
- Invariant enforcement applies immediately to all settlement and dispute actions.
- Historical prompts can be reconciled safely via `reconcile_sales_counter`.

### Test Strategy
- Rejection of double-refund attempts and out-of-order dispute resolutions.
- Rejection of decrement when counter is 0 failing with `ArithmeticOverflow` without state corruption.
- Reconciliation of sales counters.

---

## Issue #654: Quarantine Unsupported Contract Events Without Advancing Lossy Indexer Checkpoint

### Current State
- Unknown or malformed events were logged and silently skipped, allowing the indexer checkpoint (`lastIndexedLedger`) to advance past critical unhandled state.

### Proposed Design
- Add `QuarantinedEvent` Mongoose model storing `eventId`, `ledger`, `txHash`, `contractId`, `topic`, `rawTopic`, `rawValue`, `reason`, `status`, and `errorDetails`.
- In `processEvent`, catch malformed XDR or unsupported event versions and persist them to `QuarantinedEvent` while tracking `quarantinedCount` and `quarantinedLedgers` on `IndexerState`.
- Emit warning logs and structured alerts for operator monitoring.
- Implement `replayQuarantinedEvents(options)` and CLI script `scripts/replay-quarantined-events.ts` for idempotent replay after decoder schema upgrades.

### Compatibility & Rollout
- Non-breaking; preserves unhandled events safely without blocking progress on other events.
- Replay is idempotent, processing events in ledger sequence order and closing checkpoint gaps.

### Test Strategy
- Unit and integration tests for malformed XDR, unknown topic versions, quarantine persistence, checkpoint integrity, and mid-replay idempotence.

