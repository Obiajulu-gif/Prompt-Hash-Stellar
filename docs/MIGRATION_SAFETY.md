# Migration Safety Framework Guide (Issue #833)

## Overview
The Migration Safety Framework provides dry-run previews, automated post-checks, and rollback procedures for schema and data migrations.

## Workflow

### 1. Dry Run Preview
Simulates transforms over target collections without mutating records:
```bash
node scripts/migration-safety.mjs --dry-run --migration=001_payout_basis_points
```

### 2. Execution & Post-Validation
Applies transformations and asserts that post-validation checks pass on every updated record. If any check fails, errors are recorded and rollback plans are generated.

### 3. Verification
```bash
node scripts/migration-safety.mjs --verify --migration=001_payout_basis_points

```

## Legacy Fixture Pack (Issue #834)

### Overview
The legacy fixture pack provides deterministic records for previous schema versions so migrations and compatibility layers can be tested against realistic old shapes. Fixtures are checked in at:

```
tests/fixtures/legacy/
  v1-clean.json
  v1-missing-field.json
  v1-deprecated-field.json
  v1-incompatible.json
```

### Provenance
Each fixture is derived from a real shape observed in the legacy prompt marketplace data before the current schema was introduced. The `v1` shape corresponds to the original Stellar prompt publishing payload with a flat `price` field and no `pricing` object. Field names and types were captured from the legacy marketplace API responses and the old TypeScript interfaces.

### Intended Coverage
- `clean`: a valid legacy record that should migrate without errors.
- `missing-field`: a legacy record missing a required field; the migration must report a validation error and not produce an invalid current record.
- `deprecated-field`: a legacy record containing a deprecated field; the migration must drop or translate it and produce a valid current record.
- `incompatible`: a legacy record with a type that cannot be migrated; the migration must fail with a clear error.

### Running the Fixture Tests

```bash
# Validate legacy fixtures against expected old shapes
npm test -- legacy-fixtures

# Run the migration against each fixture and assert current validity
npm test -- legacy-migration

# Or via the migration safety script
node scripts/migration-safety.mjs --dry-run --migration=002_legacy_prompt_normalization
```

### Migration Contract
The legacy migration (`002_legacy_prompt_normalization`) must:
- Accept legacy records with the `creator`, `title`, `body`, `price`, `currency`, `createdAt`, and `updatedAt` fields.
- Map flat `price` into the current `pricing.amount` field and `currency` to `pricing.currency`.
- Drop the deprecated `price`, `currency`, and `tags`-as-string fields.
- Reject records missing `creator` or `title`, and records with a non-numeric `price`.
- Produce a current record that validates against the current prompt schema.

### Adding New Fixtures
When adding a new legacy shape:
1. Add the raw record to `tests/fixtures/legacy/` in JSON form.
2. Document the source shape and the expected migration outcome in this file.
3. Add a test case that asserts the expected outcome (success or error).
4. Keep fixtures deterministic: no timestamps generated at test time, no random IDs, no environment-dependent values.
