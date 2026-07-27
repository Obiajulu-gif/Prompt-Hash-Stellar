# Contract Upgrades

PromptHash Stellar utilizes a Soroban smart contract that stores prompt listings and purchase rights. As the protocol evolves, it may be necessary to upgrade the smart contract without losing the underlying state (prompt data, purchase records, balances). 

The contract implements the `Ownable` trait, meaning that the `admin` who initialized the contract has the exclusive right to upgrade the contract's Wasm logic.

## Upgrade Assumptions & Requirements

To successfully perform an upgrade, the following conditions must be met:
1. **Admin Key Access:** You must have access to the Stellar identity/private key that was configured as the `admin` during the contract's `__constructor` initialization. Without this key, the `upgrade` invocation will fail with an authorization error.
2. **State Compatibility:** The new Wasm code must maintain state compatibility with the existing storage. This means:
   - Data structures (like `Prompt`) must be backward compatible if modifying existing fields.
   - Storage keys must not overlap unintentionally or break the current mapping of data.
3. **Soroban Environment:** The current `NETWORK` (e.g. `testnet` or `mainnet`) must be explicitly set or defined in your CLI when performing the upgrade to ensure you're interacting with the correct instance.

## Upgrade Flow

We have provided an automated script to handle the compilation, installation, and upgrade process: `./scripts/upgrade.sh`.

### 1. Identify the Contract
You need the deployed contract ID. If you deployed using the deployment script, this should be in your `.env` file as `PUBLIC_PROMPT_HASH_CONTRACT_ID`. 

If not, provide it explicitly:
```bash
export CONTRACT_ID=C...
```

### 2. Configure Your Environment
Ensure your `ADMIN_ALIAS` identity exists in your local `stellar-cli` configuration (`stellar keys address admin`). 

By default, the script targets `testnet`. To target a different network, set the `NETWORK` variable:
```bash
export NETWORK=mainnet
export ADMIN_ALIAS=admin_mainnet
```

### 3. Run the Upgrade Script
Execute the upgrade script from the repository root:
```bash
./scripts/upgrade.sh
```

### What the script does under the hood:
1. **Builds the Contract:** Compiles the rust source code and outputs it to `target/wasm32-unknown-unknown/release/prompt_hash.wasm`.
2. **Optimizes the Wasm:** Runs `stellar contract optimize` to reduce the Wasm size.
3. **Installs the Wasm (Compute Hash):** Uploads the optimized Wasm code to the Stellar network using `stellar contract install`. This returns a `WASM_HASH`. It does not execute or instantiate the contract.
4. **Applies the Upgrade:** Invokes the `upgrade` method on the currently running contract, passing in the new `WASM_HASH`. The contract logic (specifically the `env.deployer().update_current_contract_wasm(new_wasm_hash)` call) safely replaces the contract's executing code while retaining all storage.
5. **Verifies:** Calls a read-only endpoint (`get_all_prompts`) to ensure the contract is still responsive and healthy.

## Safety Considerations

- **Always test upgrades on `testnet`** before executing them on production.
- If you're altering data structures (e.g. adding fields to `Prompt`), ensure you test the migration path thoroughly. Soroban strictly enforces data types; reading an old `Prompt` struct as a new `Prompt` struct with different fields will panic if not explicitly handled via enum versioning or backward-compatible storage keys.
- Monitor fee configurations post-upgrade to ensure no regression occurs.

## Preflight Checks (#435)

`scripts/upgrade.sh` runs `scripts/preflight_upgrade.py check` before it
builds or touches the network. The gate:

1. **Diffs the contract's public interface** — `PromptHashTrait` functions,
   `Error` codes, every `#[contracttype]` enum/struct (storage keys and
   record layouts), and `#[contractevent]` structs — against the checked-in
   snapshot at `contracts/prompt-hash/spec-baseline.json`. Removing or
   reshaping any of these is a breaking change; additions are not.
2. **Fails the upgrade** if a breaking change is found and it hasn't been
   acknowledged in `contracts/prompt-hash/MIGRATION.md` (see that file for
   the exact format). CI runs the same diff offline on every PR that touches
   `contracts/**` via `python3 scripts/preflight_upgrade.py check --self-check`.
3. **Validates the deployment environment** — `CONTRACT_ID` is set and not a
   placeholder, the RPC endpoint is reachable, and the `ADMIN_ALIAS` identity
   is configured in the local `stellar-cli` — before any Wasm is built or
   installed.
4. **Writes a deployment manifest** to `deploy-manifests/` recording the
   network, contract ID, git commit, baseline/spec hashes, and any
   acknowledged breaking changes. Set `MANIFEST_SIGNING_KEY` to the path of
   an Ed25519/RSA private key (PEM) to have the manifest signed with
   `openssl dgst -sha256 -sign`; otherwise it's written unsigned with
   instructions to sign it retroactively.

After an intentional interface change, regenerate the baseline and commit it:

```bash
python3 scripts/preflight_upgrade.py generate-baseline
```

### Rollback / forward-fix

- **Rollback:** every `deploy-manifests/*.json` file records the Wasm hash
  that was live *before* the upgrade it describes (via `stellar contract
  install` output kept in your deploy history — installed Wasm blobs remain
  addressable by hash indefinitely). Re-run the `upgrade` invocation with
  that previous hash to revert:
  ```bash
  stellar contract invoke --id $CONTRACT_ID --source $ADMIN_ALIAS \
    --network $NETWORK -- upgrade --new_wasm_hash <previous_wasm_hash>
  ```
- **Forward-fix:** patch the source, regenerate the baseline if the fix is
  itself interface-breaking, and run `scripts/upgrade.sh` again — the
  preflight gate re-validates the new version before it ships.
- Exercise both paths on `testnet` first; `scripts/verify.sh` confirms the
  contract is responsive and correctly configured after either action.
