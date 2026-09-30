# Schema Versioning and Stable Pagination

This document describes how Prompt Hash Stellar handles schema version metadata on stored records and how cursor-based pagination prevents duplicate or skipped results when lists change concurrently.

---

## Schema Versioning

### Why it exists

MongoDB's schemaless nature means documents written by older deployments may be missing fields that newer code expects. Without explicit version tracking, the read path must guess what a document contains and apply fragile `?? default` chains scattered across the codebase.

The schema versioning layer gives each document a `schemaVersion` integer that encodes exactly which shape was used when the document was written. Read-path transforms then upgrade older records to the current shape before they leave the API.

### Affected collections

| Collection | `schemaVersion` default | Current version constant |
|---|---|---|
| `prompts` | `2` | `CURRENT_PROMPT_SCHEMA_VERSION` in `schemaVersioning.ts` |
| `reviews` | `2` | `CURRENT_REVIEW_SCHEMA_VERSION` in `schemaVersioning.ts` |

### Version semantics

| Version | Meaning |
|---|---|
| absent / `0` | Pre-migration record; treated as version 0 by the transform layer. |
| `1` | First backfilled version (migration 006). Lifecycle fields may be absent on Prompts; `status` field may be absent on Reviews. |
| `2` | Current. All guaranteed fields are present on every write. |

### How records are upgraded on read

Every API response for a Prompt or Review passes through the transform layer (`server/src/services/schemaVersioning.ts`) before being returned:

```
DB document (any version)
        │
        ▼
transformPromptForApi() / transformReviewForApi()
        │
        ├─ version == current  →  pass-through, no mutation
        ├─ version < current   →  fill missing fields with safe defaults
        └─ version > current   →  throw SchemaVersionError → HTTP 422
        │
        ▼
Normalised API response (always current shape)
```

Clients always receive the latest shape. No client needs to handle legacy shapes.

### Guaranteed fields after transform

**Prompt**

| Field | Default for old records |
|---|---|
| `schemaVersion` | Bumped to `CURRENT_PROMPT_SCHEMA_VERSION` |
| `lifecycleState` | Back-derived from `listingStatus` + `moderationStatus` + `isActive` |
| `moderationStatus` | `"none"` |
| `tags` | `[]` |
| `description` | `""` |
| `licence` | `"standard"` |

**Review**

| Field | Default for old records |
|---|---|
| `schemaVersion` | Bumped to `CURRENT_REVIEW_SCHEMA_VERSION` |
| `status` | `"published"` (pre-moderation records were implicitly published) |
| `id` | Derived from `_id` |
| `createdAt` | Millisecond timestamp (converted from `Date` if needed) |
| `verified` | `true` |
| `text` | `""` |

### Unsupported future versions (HTTP 422)

A document with `schemaVersion` greater than the constant this build knows about means it was written by a **newer** deployment. Attempting to return it would silently drop unknown fields or misinterpret semantics. The transform throws `SchemaVersionError`, which controllers convert to:

```json
{
  "error": "Unsupported Prompt schema version 99. This build supports up to version 2.",
  "supportedSchemaVersion": 2
}
```

HTTP status: `422 Unprocessable Entity`.

This is a signal to roll forward rather than roll back: the receiving instance needs upgrading, not the data.

### Stamping `schemaVersion` on new writes

Any service that creates or updates a Prompt or Review should stamp the current version:

```ts
import { currentPromptSchemaVersion, currentReviewSchemaVersion } from "../services/schemaVersioning";

// On Prompt insert/update
await Prompt.create({ ...fields, schemaVersion: currentPromptSchemaVersion() });

// On Review insert
await Review.create({ ...fields, schemaVersion: currentReviewSchemaVersion() });
```

The Mongoose model default (`default: 2`) also stamps new documents automatically, but being explicit is preferred at write boundaries.

### Bumping the schema version

When you add a required field, change a default, or alter an enum:

1. Increment `CURRENT_PROMPT_SCHEMA_VERSION` or `CURRENT_REVIEW_SCHEMA_VERSION` in `server/src/services/schemaVersioning.ts`.
2. Add a `version < N` case in the corresponding `transform*ForApi` function.
3. Add a numbered migration under `server/src/db/migrations/` (see migration 006 as a template) to backfill existing documents.
4. Update `server/src/tests/schemaVersioning.test.ts` with a new fixture and test cases.
5. Run `yarn workspace prompthash-server test` to confirm all tests pass.

---

## Stable Cursor Pagination

### Problem with offset pagination

Offset (`SKIP n, LIMIT m`) is unstable when the underlying list changes between page requests:

- A new record inserted before page 2's offset causes every subsequent record to shift by one, **duplicating** the last record of page 1.
- A hidden or deleted record before the offset causes records to shift the other way, **skipping** one record.

### Cursor-based solution

All list endpoints use a cursor that encodes the position of the last record seen. The next page query asks for records *before that position*, not records at a numeric offset.

#### Prompt list (`GET /api/prompts`)

Cursor key: `_id` (MongoDB ObjectId, monotonically increasing by insertion time).

```
Page 1: { _id: { $lt: MAX } }  sort: _id DESC  limit: N+1
         → returns [r10, r9, r8, ...]  nextCursor = r8._id

Page 2: { _id: { $lt: r8._id } }  sort: _id DESC  limit: N+1
         → returns [r7, r6, r5, ...]
```

A new record inserted between requests gets `_id > r10`, which is above page 1's range and below the next fetch's range — it never duplicates or skips.

#### Review list (`GET /api/reviews/list`)

Cursor key: composite `(createdAt DESC, _id DESC)`.

`_id` alone is sufficient for prompts (inserted once, never re-ordered). Reviews can have identical `createdAt` values (clock resolution), so a tie-breaker is needed. The compound cursor prevents duplicates even when multiple reviews share a timestamp.

The cursor is a base64url-encoded JSON object:

```json
{ "createdAt": "2024-06-02T12:00:00.000Z", "id": "664f..." }
```

Next page query:

```js
{
  $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
  ]
}
```

#### Filter behaviour for hidden / deleted / flagged records

| Status | Public list | Paginated list |
|---|---|---|
| `published` | ✅ visible | ✅ included |
| `flagged` | ✅ visible (badge shown) | ✅ included |
| `hidden` | ❌ excluded | ❌ excluded via `{ status: { $nin: ["hidden", "deleted"] } }` |
| `deleted` | ❌ excluded | ❌ excluded |

Removing a hidden record between page requests does **not** shift the cursor boundary, because hidden records are never included in the visible sequence from which the cursor was derived.

### Response envelope

All paginated list endpoints return:

```json
{
  "data" / "reviews": [...],
  "stats": { ... },           // review list only
  "metadata" / "pagination": {
    "hasNextPage": true,
    "nextCursor": "<opaque string or null>"
  }
}
```

Pass `nextCursor` verbatim as the `cursor` query parameter on the next request. The cursor format is opaque — do not parse or construct it client-side.

### `includeAll` parameter (review list only)

For server-side operations that need the full visible set (stats recalculation, data export):

```
GET /api/reviews/list?promptId=<id>&includeAll=true
```

- Bypasses cursor and page-size limit.
- Calls `Review.find(...).limit(0)` (no limit).
- Always returns `hasNextPage: false`, `nextCursor: null`.
- Should only be called from server-to-server contexts; do not expose to untrusted clients.

---

## Database Migration

Migration `006_schema_version_metadata` (in `server/src/db/migrations/`) backfills `schemaVersion: 1` on all existing Prompt and Review documents that lack the field.

To apply:

```sh
yarn workspace prompthash-server db:migrate
```

To roll back:

```sh
yarn workspace prompthash-server db:rollback
```

The migration is safe to run on a live database: it uses `{ schemaVersion: { $exists: false } }` as the filter, so versioned documents are never touched, and the operation is idempotent.

---

## Validation command

```sh
# Run schema versioning + pagination tests
yarn workspace prompthash-server test

# Run only the new test files
yarn workspace prompthash-server test src/tests/schemaVersioning.test.ts src/tests/reviewPagination.test.ts src/tests/schemaVersionMigration.test.ts

# Run the schema package tests (includes migratePromptMetadata)
yarn workspace @prompthash/schema test
```

---

## Related files

| File | Purpose |
|---|---|
| `server/src/services/schemaVersioning.ts` | Transform functions, version constants, `SchemaVersionError` |
| `server/src/db/migrations/006_schema_version_metadata.ts` | Backfill migration |
| `server/src/models/Prompt.js` | Added `schemaVersion` field (default 2) |
| `server/src/models/Review.ts` | Added `schemaVersion` field (default 2) |
| `server/src/controllers/versioningControllers.ts` | Stamps version on write, applies transform on read, returns 422 |
| `api/reviews/list.ts` | Cursor-paginated review list with per-record transform |
| `api/prompts/index.ts` | Cursor-paginated prompt list (`_id`-based, pre-existing) |
| `server/src/tests/schemaVersioning.test.ts` | Unit tests: transforms, version guards, SchemaVersionError |
| `server/src/tests/reviewPagination.test.ts` | Integration tests: pagination, filters, schema compat |
| `server/src/tests/schemaVersionMigration.test.ts` | Unit tests: migration 006 up/down |
| `packages/schema/src/promptMetadata.ts` | Shared `PROMPT_METADATA_SCHEMA_VERSION`, `migratePromptMetadata()` |
