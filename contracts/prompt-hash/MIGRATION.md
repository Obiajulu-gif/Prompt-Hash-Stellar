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

<!--
Example:

### 2026-01-01 — renamed `has_access` to `check_access`

ACK-BREAKING: function `has_access` was removed from PromptHashTrait

Migration: `has_access` was renamed to `check_access` with an identical
signature. Existing storage is untouched — no data migration is required.
Indexers/SDK consumers must switch to the new method name before the
old contract version is decommissioned.
-->
