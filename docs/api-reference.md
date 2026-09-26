# API Reference

This reference covers the marketplace and account endpoints used by the PromptHash frontend and the Express backend.

## New: Payout Readiness Validation

PromptHash now includes comprehensive payout readiness validation to ensure creators can receive earnings before publishing paid prompts. 

For detailed information, see [Payout Readiness API Reference](./payout-readiness-api.md).

**Key Integration Points:**
- Form validation blocks paid prompt submission until setup is complete
- Real-time validation feedback in payout settings
- Interactive checklists guide creators through setup requirements
- Graceful error handling with actionable remediation steps

> **Machine-readable schema (#713):** a valid OpenAPI 3.0 document covering
> the marketplace endpoints below is published at
> [`docs/openapi.json`](./openapi.json). It is also served live by the backend
> and rendered as an interactive explorer:
>
> - `GET /api/openapi.json` — fetch the JSON schema
> - `GET /api/docs` — interactive (Redoc) explorer
>
> Use the schema with code generators (`openapi-generator`, `hey-api`,
> Postman import) to keep SDKs and integrations in sync with the API.

## Common Response Rules

- Successful requests return JSON.
- Validation failures return `422` with a field-level error map when available.
- Missing resources return `404`.
- Auth or ownership failures return `403`.

### Shared validation error shape

```json
{
  "error": "Invalid listing metadata",
  "fields": {
    "title": "Title is required.",
    "price": "Price must be greater than zero."
  }
}
```

## Marketplace Endpoints

### List prompts

`GET /api/prompts`

Returns published, active marketplace prompts using cursor-based pagination (keyset on the descending `_id` order — stable under concurrent inserts).

Optional query parameters:

- `category` — filter by prompt category
- `walletAddress` — only prompts owned by this wallet
- `limit` (default 20, max 50) — page size (`pageSize` is accepted as an alias)
- `cursor` — the `nextCursor` value from a previous page; omit for the first page

Example response:

```json
{
  "data": [
    {
      "_id": "6650f1...",
      "image": "https://example.com/cover.png",
      "title": "Launch Strategy Pack",
      "content": "Public preview text ...",
      "owner": {
        "username": "faithorji",
        "walletAddress": "g..."
      },
      "price": 2.5,
      "category": "Marketing",
      "listingStatus": "published",
      "isActive": true,
      "salesCount": 12
    }
  ],
  "metadata": {
    "hasNextPage": false,
    "nextCursor": null
  }
}
```

`metadata.hasNextPage` is `true` when another page follows; `metadata.nextCursor`
then holds the `_id` to pass back as `cursor` to fetch that page. A `null`
`nextCursor` means the last page was reached.

### Create a prompt

`POST /api/prompts`

Creates a creator listing after validating and normalizing the listing metadata.

Request body:

```json
{
  "image": "https://example.com/cover.png",
  "title": "Launch Strategy Pack",
  "content": "Long-form prompt content",
  "walletAddress": "g...",
  "price": 2.5,
  "category": "marketing"
}
```

Example response:

```json
{
  "message": "Prompt created successfully",
  "prompt": {
    "_id": "6650f1...",
    "title": "Launch Strategy Pack",
    "price": 2.5,
    "category": "Marketing"
  }
}
```

### Publish a draft

`POST /api/prompts/:id/publish`

Publishes a draft prompt after validating required fields.

Example error response:

```json
{
  "error": "Prompt is not publishable",
  "fields": {
    "content": "Content is required."
  }
}
```

### Archive a prompt

`POST /api/prompts/:id/archive`

Marks a prompt as archived and removes it from active workflow views.

## Buyer Library Endpoints

### Get owned prompts

`GET /api/prompts/buyer/:walletAddress/owned`

Returns prompts tied to purchases for the buyer wallet.

Example response:

```json
{
  "owned": [
    {
      "purchaseId": "66a1...",
      "prompt": {
        "_id": "6650f1...",
        "title": "Launch Strategy Pack",
        "content": "Public preview text ...",
        "category": "Marketing"
      },
      "txHash": "tx_123",
      "versionIndex": 1,
      "purchasedAt": "2026-05-28T10:15:30.000Z"
    }
  ]
}
```

### Get saved prompts

`GET /api/prompts/buyer/:walletAddress/saved`

Returns the buyer's saved marketplace listings.

Example response:

```json
{
  "saved": [
    {
      "purchaseId": "66a1...",
      "prompt": {
        "_id": "6650f1...",
        "title": "Launch Strategy Pack",
        "content": "Preview text ...",
        "price": 2.5,
        "category": "Marketing",
        "owner": {
          "username": "faithorji"
        }
      },
      "savedAt": "2026-05-28T10:15:30.000Z"
    }
  ]
}
```

### Save a prompt

`POST /api/prompts/buyer/save`

Request body:

```json
{
  "walletAddress": "g...",
  "promptId": "6650f1..."
}
```

Example response:

```json
{ "saved": true, "purchaseId": "66a1..." }
```

### Remove a saved prompt

`POST /api/prompts/buyer/unsave`

Request body:

```json
{
  "walletAddress": "g...",
  "promptId": "6650f1..."
}
```

Example response:

```json
{ "saved": false }
```

## Creator Workspace Endpoints

### Get draft prompts

`GET /api/prompts/creator/:walletAddress/drafts`

Returns draft and ready-to-publish prompts for the connected creator wallet.

### Creator sales analytics

`GET /api/prompts/creator/:walletAddress/analytics`

Returns daily sales and revenue for the trailing 30-day window:

```json
{
  "dailySales": [
    { "date": "2026-07-29", "unitsSold": 3, "revenueXlm": 7.5 }
  ]
}
```

### Privacy-safe support metrics (#711)

`GET /api/prompts/creator/:walletAddress/analytics/support-metrics`

Returns conversion, refund, unlock-failure, and review outcomes for the
creator's listings. **Buyer identities are aggregated server-side and never
returned**; cohorts below the minimum size are suppressed:

```json
{
  "success": true,
  "analytics": {
    "windowDays": 30,
    "cohort": { "activeBuyers": 12, "buyerIdentitiesRedacted": true },
    "totals": { "views": 420, "purchases": 38, "refunds": 2, "unlockFailures": 4, "reviews": 11 },
    "metrics": { "conversionRate": 0.0904, "refundRate": 0.0526, "unlockSuccessRate": 0.8947, "satisfactionRate": 0.8181, "averageRating": 4.3 },
    "unlockFailuresByReason": { "integrity_failure": 3, "no_access": 1 }
  }
}
```

### Purchase transactions (#711)

`GET /api/prompts/buyer/:walletAddress/transactions`

Returns the buyer's licensing/purchase history, each row pairing an on-chain
purchase with its prompt:

```json
{
  "transactions": [
    {
      "id": "...",
      "promptId": "123",
      "promptTitle": "Launch Strategy Pack",
      "promptImage": "https://...",
      "amountXlm": 2.5,
      "versionIndex": 1,
      "txHash": "...",
      "createdAt": "2026-07-29T10:15:30.000Z"
    }
  ]
}
```

### Abuse reports & triage (#714)

`POST /api/prompts/reports` — submit a report (public). Reporters may attach
up to 10 evidence items:

```json
{
  "promptId": "12345",
  "reporterAddress": "G...",
  "reason": "copyright",
  "description": "Optional details",
  "evidence": [
    { "url": "https://source.example/original.pdf", "kind": "pdf" }
  ]
}
```

`GET /api/prompts/reports` — moderation queue (admin token required). Filter
by `?status=pending|investigating|resolved|dismissed`.

`PATCH /api/prompts/reports` — update triage status/notes (admin token
required). Triage is **forward-only**: `pending → investigating →
resolved|dismissed`; regressions and re-opens are rejected with `409`.

```json
{
  "reportId": "report_1",
  "status": "investigating",
  "adminNotes": "Comparing against the provided source.",
  "evidence": [{ "url": "https://s3.example/123.png", "kind": "image" }]
}
```

## Version updates

`POST /api/prompts/version`

Creates a new version for a prompt owned by the calling wallet.

## Account And Auth Flow

### Challenge token

`POST /api/unlock/challenge`

Issues a short-lived challenge token for wallet verification.

### Unlock prompt

`POST /api/unlock/verify`

Verifies the wallet signature and on-chain entitlement before returning decrypted content.

## Purchase Receipts (#436)

### Get a purchase receipt

`GET /api/prompts/receipt?promptId=&buyerWallet=&txHash=`

`txHash` is optional — when omitted, the most recent matching `Purchase`
record is used only to look up the hash. Every other field is re-derived
from the confirmed transaction and its contract event on Stellar RPC, never
from the (mutable) database row. Responds with:

```json
{
  "receipt": { "version": 1, "network": { ... }, "contract": { ... }, "prompt": { ... }, "buyer": "G...", "amount": { "stroops": "..." }, "transaction": { ... }, "event": { ... } },
  "signature": "base64 Ed25519 signature over the canonicalized receipt",
  "signerPublicKey": "base64 Ed25519 public key"
}
```

Verify a receipt independently — against Stellar RPC only, no PromptHash API
or database access required — with `@prompthash/sdk`:

```ts
import { verifyReceipt } from "@prompthash/sdk";

const result = await verifyReceipt(receipt, signature, signerPublicKey);
// result.valid, result.checks.{signatureValid,networkMatches,transactionFound,transactionSucceeded,eventMatches}
// result.currentEntitlement — best-effort live has_access/dispute signal, never affects `valid`
```

`result.valid` is `true` only when the signature checks out **and** the
referenced transaction is found, succeeded, on the claimed network, and its
decoded event matches every receipt field exactly — so a receipt with any
tampered field, a wrong-network mismatch, or an orphaned/failed transaction
fails verification.

## Wallet Sessions

Self-service routes that act for a wallet (buyer library, provenance
declarations) need a short-lived session proving the caller controls it.

1. `GET /api/wallet-session/challenge?walletAddress=G...` → `{ token, challenge, expiresAt }`
2. Sign `challenge` with the wallet, then
   `POST /api/wallet-session` with `{ walletAddress, token, signedMessage }` →
   `{ walletAddress, sessionToken, expiresAt }` (valid for 30 minutes; each
   challenge can be used once).
3. Send `Authorization: Bearer <sessionToken>`. A session only works for the
   wallet it was issued to; anything else gets `401`.

## Buyer Library (#784)

All routes require a wallet session for `:walletAddress`. Collections and
archive state live in their own collections, so organising a library never
changes purchase (ownership) records.

### Get the library

`GET /api/library/:walletAddress?q=&collection=&archived=exclude|only|include&health=`

```json
{
  "entries": [
    {
      "promptId": "42",
      "title": "Launch Strategy Pack",
      "category": "Marketing",
      "purchasedAt": "2026-09-01T10:00:00.000Z",
      "txHash": "…",
      "archived": false,
      "collectionIds": ["66f0…"],
      "entitlement": { "health": "active", "purchaseStatus": "purchased", "disputeStatus": null }
    }
  ],
  "collections": [{ "id": "66f0…", "name": "Favourites", "promptIds": ["42"], "promptCount": 1 }],
  "counts": { "total": 5, "archived": 1 }
}
```

`health` is `active`, `recovery_needed` (paid, but the delivery is disputed),
`refunded`, or `revoked`. Only the wallet's own purchases are ever listed or
searched.

### Organise

- `POST /api/library/:walletAddress/collections` — `{ name, description?, promptIds? }`
- `PATCH /api/library/:walletAddress/collections/:collectionId` — `{ name?, description?, addPromptIds?, removePromptIds? }`
- `DELETE /api/library/:walletAddress/collections/:collectionId`
- `PUT /api/library/:walletAddress/items/:promptId` — `{ archived: boolean }`

Only prompts the wallet currently owns (not refunded or revoked) can be added
to a collection (`403` otherwise). Another wallet's collections return `404`.

## Disputed Purchases (#755)

- `GET /api/fulfillment/:promptId/:buyerWallet` — buyer view: status, unlock
  attempts, timeline, maintainer notes, refund eligibility. No wallet,
  transaction, or maintainer metadata.
- `POST /api/fulfillment/:promptId/:buyerWallet/request-refund` — `{ reason, disputeTxHash? }`
- `GET /api/fulfillment/disputes?status=` — maintainer queue (`fulfillment:read`), oldest first with `stale` flags.
- `POST /api/fulfillment/:promptId/:buyerWallet/retry` — `{ notes? }` (`fulfillment:resolve`)
- `POST /api/fulfillment/:promptId/:buyerWallet/resolve` — `{ refund, resolutionTxHash?, notes? }` (`fulfillment:resolve`)
- `POST /api/fulfillment/:promptId/:buyerWallet/close` — `{ notes }` (`fulfillment:resolve`)
- `POST /api/fulfillment` — service report of a delivery outcome (`pending`, `delivered`, `failed`; `fulfillment:write`)

Actions that are not allowed in the current state return `409`. A repeated
action (same `Idempotency-Key`) or redelivered event returns `200` with
`idempotent: true` and changes nothing. The state machine is documented in
[operations/audit-log-usage.md](./operations/audit-log-usage.md#disputed-purchases).

## Prompt Provenance (#753)

- `GET /api/provenance/:promptId` — public lineage:

  ```json
  {
    "promptId": "42",
    "ancestors": [
      { "promptId": "7", "derivedPromptId": "42", "kind": "remix", "origin": "creator", "depth": 1, "visibility": "public", "title": "…", "link": "/prompts/7" },
      { "promptId": "3", "derivedPromptId": "7", "kind": "source", "origin": "creator", "depth": 2, "visibility": "deleted", "title": null, "link": null }
    ],
    "derivatives": [],
    "derivativeCount": 0,
    "truncated": false
  }
  ```

  `kind` is `parent`, `fork`, `remix`, or `source`. Listings that are hidden
  by moderation, unlisted, or deleted keep their place in the lineage, but
  their title and link are withheld.
- `POST /api/provenance/:promptId/relations` — `{ creatorWallet, relatedPromptId, kind }`,
  creator's wallet session required. Returns `409` for self-references,
  cycles, a second `parent`, or a duplicate.
- `DELETE /api/provenance/:promptId/relations/:relatedPromptId?creatorWallet=`
- `GET /api/provenance/admin/flags` — moderation flags (`provenance:read`):
  `cross_creator_parent`, `deep_fork_chain`, `undeclared_similarity`,
  `unconfirmed_attribution`.

Migration `003_prompt_provenance` backfills unconfirmed `source` relations
(`origin: "backfill"`) from existing similarity detections. Creators can
confirm or remove them from the prompt page.

## Audit Export (#783)

`GET /api/audit/export` and `POST /api/audit/export/verify` (scope
`audit:export`). Filters, schema, and the verification procedure are in
[operations/audit-log-usage.md](./operations/audit-log-usage.md#exporting-activity-for-audits).

## Notes For Frontend Contributors

- Listing metadata is normalized server-side before persistence.
- Category casing is canonicalized so the frontend can send user-friendly values.
- The buyer dashboard reads from `/api/prompts/buyer/:walletAddress/saved` and `/api/prompts/buyer/:walletAddress/owned` to populate separate library sections.
- Save and unsave actions are intentionally idempotent from the UI perspective.
