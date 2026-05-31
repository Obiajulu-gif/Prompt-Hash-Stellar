# Contract Upgrades

PromptHash uses Soroban's current-contract Wasm replacement flow so contract logic can be upgraded while the existing contract address and storage remain in place.

## Upgrade Authority

Only the stored contract admin can upgrade the PromptHash contract. The admin is set during `__constructor` with `ownable::set_owner(&env, &admin)` and is stored by the OpenZeppelin Stellar `Ownable` module.

The preferred upgrade entrypoint is:

```text
upgrade_contract(admin: Address, new_wasm_hash: BytesN<32>)
```

`upgrade_contract` checks that the supplied `admin` equals the stored owner, then calls `admin.require_auth()`. A transaction from any other address returns `Unauthorized`; a transaction that names the admin but is not signed by the admin fails Soroban authorization.

The older `upgrade(new_wasm_hash: BytesN<32>)` entrypoint remains available for compatibility and also authorizes the stored owner before upgrading.

## Pre-Upgrade Checklist

Before upgrading any production contract:

1. Confirm the target network and contract ID.
2. Confirm the admin signer is the expected stored owner.
3. Review the new contract code, generated contract spec, and public API compatibility.
4. Run unit tests and a testnet upgrade rehearsal.
5. Confirm storage keys and serialized types are backward compatible, or prepare a migration plan.
6. Verify the new Wasm hash from the upload command matches the reviewed artifact.
7. Prepare monitoring for the upgrade transaction, emitted events, and critical read methods such as `get_all_prompts`, `get_prompt`, and fee getters.

Do not place admin private keys, deployment secrets, or credentials in this repository.

## Upload And Call Flow

Build and optimize the new contract Wasm:

```bash
stellar contract build
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/prompt_hash.wasm
```

Upload the reviewed Wasm to the target network:

```bash
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm \
  --source <ADMIN_ALIAS> \
  --network <NETWORK>
```

The upload returns a `WASM_HASH`. Apply the upgrade to the existing contract:

```bash
stellar contract invoke \
  --id <PROMPT_HASH_CONTRACT_ID> \
  --source <ADMIN_ALIAS> \
  --network <NETWORK> \
  -- \
  upgrade_contract \
  --admin <ADMIN_ADDRESS> \
  --new_wasm_hash <WASM_HASH>
```

The contract calls `env.deployer().update_current_contract_wasm(new_wasm_hash)`. Soroban applies the replacement after the invocation completes successfully, while preserving instance and persistent storage.

## Upgrade Event Verification

Every successful upgrade emits `ContractUpgraded` with:

- `admin`: the authorized upgrader address
- `new_wasm_hash`: the installed Wasm hash

Indexers and auditors should verify that the event appears on the upgrade transaction, that the admin matches the stored owner at the time of invocation, and that `new_wasm_hash` matches the reviewed upload artifact.

## Storage Migration Guidance

Schema-compatible upgrades can be applied directly. Schema-changing upgrades require explicit migration logic. Incompatible storage changes can corrupt state, make existing prompts unreadable, or strand purchase records.

When storage schemas change:

1. Add a stored schema or version key.
2. Add an admin-only migration function separate from `upgrade_contract`.
3. Read old storage entries and write them in the new format.
4. Emit a migration event with the admin, old version, new version, and migrated range or count.
5. Test the migration against representative existing stored state.
6. Avoid deleting or renaming keys unless the migration handles every old key.
7. Keep old readers or versioned decoding paths until all live state is migrated.

Recommended pattern:

```text
upgrade_contract(admin, new_wasm_hash)
migrate_storage(admin, from_version, to_version, batch_limit)
```

The migration function should use the same stored admin authorization pattern: compare the caller to the stored owner, call `require_auth`, perform bounded migration work, persist progress, and emit a migration event. Large migrations should be batched so each transaction stays within Soroban limits.

## Post-Upgrade Checks

After the upgrade transaction succeeds:

1. Verify the `ContractUpgraded` event.
2. Call read methods to confirm existing prompts, fee settings, pause status, and purchase access still decode correctly.
3. Run any required admin-only storage migration.
4. Verify migration events and schema version.
5. Keep monitoring failed invocations and indexer parsing for regressions.
