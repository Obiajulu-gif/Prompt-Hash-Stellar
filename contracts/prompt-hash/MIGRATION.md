# Contract Migration Notes

`scripts/preflight_upgrade.py` blocks an upgrade whenever it detects a
breaking change to the contract's public interface (a removed/changed
trait function, error code, storage-key/record shape, or event) relative to
`contracts/prompt-hash/spec-baseline.json`.

If a change is intentionally breaking, acknowledge **every** reported line
here with one `ACK-BREAKING:` entry per change (copy the exact line the
preflight tool printed), describe the migration/rollback plan below it, then
regenerate the baseline:

```bash
python3 scripts/preflight_upgrade.py generate-baseline
git add contracts/prompt-hash/spec-baseline.json contracts/prompt-hash/MIGRATION.md
```

## Log

### 2026-07-29 — catch up baseline after long-unmerged interface drift

`spec-baseline.json` was last regenerated at commit `f46aae1` ("Add
versioned event schema..."). Every PR merged since then that touched the
contract's public interface shipped without ever re-running
`generate-baseline`, so this preflight check has been silently failing
(or simply not run) for a long stretch of `main`'s history — none of the
changes below originate in this PR specifically; they accumulated across
many prior merges (the prompt sale-status enum from #485/#486, u64 prompt
IDs, the `encrypted_payload` rename, versioned events, etc.) plus the
genuinely new interface surface this PR adds for #538/#539/#541/#542
(access-pass `status`/`max_supply`, pass lifecycle methods, and the
admin-auth-adjacent signature tweaks). Acknowledging the full accumulated
list here and regenerating the baseline is a one-time catch-up so future
PRs are checked against the current, correct interface instead of a
multi-month-old snapshot.

ACK-BREAKING: function `admin_set_prompt_sale_status` signature changed
ACK-BREAKING: function `create_access_pass` signature changed
ACK-BREAKING: function `create_bundle` signature changed
ACK-BREAKING: function `set_prompt_sale_status` signature changed
ACK-BREAKING: `AccessPass`: `pub active: bool` was removed or changed shape
ACK-BREAKING: `AccessPass`: `pub sales_count: u64` was removed or changed shape
ACK-BREAKING: `Bundle`: `pub prompt_ids: Vec<u128>` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `VoucherKey(u128` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `BytesN<32>)` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `ListingRevision(u128` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `u32)` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `PurchaseDispute(u128` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `Address)` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `Bundle(u128)` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `BundleCounter` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `CreatorBundles(Address)` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `AccessPass(u128)` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `AccessPassCounter` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `CreatorAccessPasses(Address)` was removed or changed shape
ACK-BREAKING: `InstanceDataKey`: `CatalogPass(Address` was removed or changed shape
ACK-BREAKING: `Prompt`: `pub encrypted_prompt: String` was removed or changed shape
ACK-BREAKING: `Prompt`: `pub active: bool` was removed or changed shape
ACK-BREAKING: event `PromptAdminModerated` field list changed
ACK-BREAKING: event `PromptSaleStatusUpdated` field list changed

Migration: this is a pre-launch contract with no live mainnet deployment
and no real on-chain state to migrate — `set_prompt_max_supply` (#538),
the access-pass lifecycle/renewal fields (#539), and the escrow
`dispute_deadline`/permissionless-settlement fields (#541) are additive
on top of already-changed storage shapes from prior merges. Any testnet
instance deployed against an older interface must be redeployed fresh
rather than upgraded in place.

<!--
Example:

### 2026-01-01 — renamed `has_access` to `check_access`

ACK-BREAKING: function `has_access` was removed from PromptHashTrait

Migration: `has_access` was renamed to `check_access` with an identical
signature. Existing storage is untouched — no data migration is required.
Indexers/SDK consumers must switch to the new method name before the
old contract version is decommissioned.
-->
