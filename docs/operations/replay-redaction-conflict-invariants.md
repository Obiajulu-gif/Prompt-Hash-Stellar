# Replay, redaction, and conflict invariants

The issue #1219, #1212, and #1213 paths are intentionally fail-closed:

- replay normalisation sorts by the ledger/event ordering, collapses identical
  retries, and rejects the same event id when its payload bytes differ;
- telemetry redaction removes secrets and private values while preserving safe
  correlation identifiers and operational fields; and
- concurrent edits remain unresolved until an explicit resolution strategy is
  selected, so the system never silently chooses one writer's data.

The accompanying regression suite covers normal, retry, tamper, redaction,
and conflict paths. Recovery is deterministic: replay from the last accepted
checkpoint, re-export after redaction, or resolve the reported conflict before
retrying the write.
