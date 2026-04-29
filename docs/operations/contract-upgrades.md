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
