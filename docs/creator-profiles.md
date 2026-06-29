# Creator Profiles

Prompt Hash creator profiles use off-chain metadata so marketplace identity can
evolve without changing prompt ownership on-chain.

## Stellar SEP alignment

- SEP-1 defines `stellar.toml` account metadata, including human-readable
  identity fields and signing-key discovery. The profile schema mirrors this
  approach by keeping public identity metadata separate from contract state.
- SEP-10 defines wallet-based authentication. Profile edits are designed to sit
  behind the connected wallet session so the creator address remains the source
  of authority.
- SEP-2 federation is complementary for future account discovery. Display names
  and profile links can later be mapped to federated Stellar addresses without
  changing prompt records.

## Storage model

Profile metadata contains:

- Stellar creator address
- display name
- bio
- avatar URL
- website URL
- X/Twitter handle
- optional `ipfs://` metadata URI

When `PUBLIC_PINATA_JWT` is configured, profile JSON is pinned to IPFS through
Pinata and the resulting `ipfs://<cid>` is stored in the browser profile index.
When IPFS is not configured, the same JSON is stored in local off-chain storage
for development and preview deployments.

The marketplace keeps prompt ownership on-chain and resolves profile metadata at
the UI layer, so a failed profile lookup falls back to a shortened Stellar public
key instead of blocking purchases or unlocks.
