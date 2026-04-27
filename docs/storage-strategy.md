# Soroban Storage Strategy & Lifecycle Management

This document outlines how `prompt-hash` manages smart contract storage, TTL (Time To Live), rent, and archival recovery.

## Storage Types & Lifetimes

The contract uses three types of Soroban storage:

| Storage Type | Key(s) | Lifetime Policy |
|--------------|--------|-----------------|
| **Instance** | `PromptCounter`, `FeePercentage`, `FeeWallet`, `XlmAddress`, `Owner` | Extended on every config read/write. 7-day threshold, 30-day extension. |
| **Persistent** | `Prompt(id)`, `CreatorPrompts(addr)`, `BuyerPrompts(addr)`, `Purchase(id, addr)` | User-specific data. Extended on every access. 30-day threshold, 180-day extension. |
| **Temporary** | `Reentrancy` | Transient data. No explicit extension; naturally expires if not cleaned up. |

## TTL Policies

We use the following constants for TTL management (assuming ~5s ledger time):

- `DAY_IN_LEDGERS`: 17,280
- `INSTANCE_TTL_THRESHOLD`: 1 week (7 days)
- `INSTANCE_TTL_EXTEND`: 1 month (30 days)
- `PERSISTENT_TTL_THRESHOLD`: 1 month (30 days)
- `PERSISTENT_TTL_EXTEND`: 6 months (180 days)

## Rent & Payment

- **Who Pays?**: The caller of any contract function that triggers a TTL extension pays the rent for that extension. Since extensions are integrated into every read/write path, users naturally maintain the data they interact with.
- **Protocol Maintenance**: The protocol owner should periodically call `get_fee_percentage()` or similar instance-read functions to ensure the contract's Instance storage (including the owner record) remains live even during low-activity periods.

## Archival & Recovery

If a `Persistent` entry is not accessed for more than 6 months, it may be **archived** by the network.

### Detecting Archival
An indexer or backend will notice that a `get_prompt` call fails or returns null for a previously known ID, but the `PromptCounter` still indicates it should exist.

### Restoration Steps
1. **Identify the archived key**: Determine the `DataKey` for the missing data (e.g., `DataKey::Prompt(123)`).
2. **Obtain Proof/Data**: Use a Stellar history archive or a specialized state indexer to retrieve the ledger entry's last known value and proof of existence.
3. **Restore**: Submit a Soroban transaction with the appropriate `RestoreFootprint` to bring the archived state back into the active ledger.
4. **Interact**: Once restored, call any function that reads the data (like `get_prompt`) to trigger a fresh TTL extension.

## Backend/Indexer Implications
Indexers can rely on the fact that any data they can successfully read from the contract has at least 30 days of life remaining. If a read fails due to archival, the indexer should trigger the restoration workflow.
