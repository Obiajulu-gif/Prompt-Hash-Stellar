# Schema Compatibility Policy

## Supported versions

The prompt metadata schema currently uses version 1.
The schema package declares supported legacy versions in
`LEGACY_PROMPT_SCHEMA_VERSIONS`.

- Schema version 1 is the current version.
- Version 0 is retained as a legacy version where supported by migration logic.
- Unknown future schema versions must be rejected rather than silently misinterpreted.
- Contract, API, and indexed-data schemas must document their own versioning rules
  and must not assume that all consumers upgrade simultaneously.

## Compatibility guarantees

### Additive changes

Adding optional fields with safe defaults is backward-compatible.
Older clients should ignore unknown response fields, and newer clients should
supply documented defaults when reading retained records that omit optional fields.

### Removed fields

Removing a required field is a breaking change. Keep it available during a
deprecation period or introduce a new schema version with a migration path.
Migration note: migrate retained records before removing the field; rollback by
restoring the previous schema or retaining the original field until rollback
is no longer required.

### Renamed fields

Renaming a field is a breaking change unless both names are supported during
a transition. Read the old field during migration and write the new field
alongside it until consumers have upgraded.
Migration note: backfill the new field from the old field before switching
consumers. Rollback by continuing to read the old field or restoring the
previous schema version.

### Type-changed fields

Changing a field's type is a breaking change unless a documented conversion
preserves existing values. Validate conversions before migration and reject
values that cannot be converted safely.
Migration note: back up retained data and convert it using a versioned
migration. Rollback by restoring the backup or using a reversible conversion.

### Removed enum values

Do not remove an enum value while retained records or supported clients may
still use it. Map deprecated values to a documented replacement when safe;
otherwise reject them with a clear validation error.
Migration note: migrate affected records before removal. Rollback by restoring
the prior enum value and its mapping.

## Contract event records (#1128)

Contract events (`server/src/services/eventVersions.ts`) are versioned
records that deployed contracts emit and the indexer keeps forever. They can
arrive before or after a consumer upgrade. Ingestion paths should call
`classifyEventRecord(eventType, data)`. It never throws, and it returns
either `accept` or `quarantine` with a reason:

| Record shape | Disposition | Reason | `retryAfterUpgrade` |
|---|---|---|---|
| Supported version, required fields present, unknown extra fields | accept | | |
| No `version` field | accepted as implicit V1 | | |
| Newer version than the consumer supports | quarantine | `unsupported_version_N_requires_consumer_upgrade` | `true` |
| Version older than any supported one (retired) | quarantine | `unsupported_version_N` | `false` |
| Unknown event type | quarantine | `unknown_event_type` | `true` |
| `version` present but not a positive integer (`"2"`, `0`, `1.5`, `null`) | quarantine | `malformed_version` | `false` |
| Missing, renamed, or type-changed required field (e.g. `price_stroops: 12.5`) | quarantine | `invalid_structure` | `false` |
| Authority-bearing record without its actor (moderation without `admin`, purchase without `buyer`/`creator`) | quarantine | `invalid_structure` | `false` |
| Payload that is `null`, an array, or a primitive | quarantine | `invalid_payload` | `false` |

`price_stroops` (Soroban `i128`) may be decoded as a `bigint`, a safe integer,
or a decimal string. Floats and other strings count as a type change.

**Retry and rollback.** Classification is pure. Re-running it on a quarantined
record after a consumer deploy that adds the version accepts the record. If
that consumer is rolled back, the newer records are quarantined again and V1
records stay readable. Only records with `retryAfterUpgrade: true` need to be
replayed after an upgrade. The rest need a data fix or a contract fix.

**Contract preserved.** `detectEventVersion` and `validateEventStructure` keep
their signatures. `detectEventVersion` still treats a non-numeric `version`
as V1. That is why ingestion should use `detectEventVersionStrict` /
`classifyEventRecord`. `validateEventStructure` now returns an error for a
non-object payload instead of throwing, and it rejects a non-integer
`price_stroops`.

`server/src/tests/eventRecordSchemaCompatibility.test.ts` keeps a canonical
fixture for every `(event type, version)` in `SUPPORTED_VERSIONS`. Adding a
version fails that suite until a fixture is added, which forces a
compatibility review.

## Release checklist

- Update the schema version and supported-version list when required.
- Test older clients against newer responses.
- Test newer clients against retained older records.
- Cover added, removed, renamed, and type-changed fields.
- For a new contract event version, add a canonical fixture and a
  `VERSION_METADATA` entry, and deploy the consumer before the contract.
- Document a migration or rollback plan for every incompatible change.
- Run the relevant schema tests and build before releasing.
