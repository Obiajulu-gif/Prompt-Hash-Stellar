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

## Release checklist

- Update the schema version and supported-version list when required.
- Test older clients against newer responses.
- Test newer clients against retained older records.
- Cover added, removed, renamed, and type-changed fields.
- Document a migration or rollback plan for every incompatible change.
- Run the relevant schema tests and build before releasing.
