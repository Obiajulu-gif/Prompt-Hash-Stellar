# API Reference

This reference covers the marketplace and account endpoints used by the PromptHash frontend and the Express backend.

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

Returns published, active marketplace prompts.

Optional query parameters:

- `category`
- `walletAddress`

Example response:

```json
[
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
]
```

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

### Version updates

`POST /api/prompts/version`

Creates a new version for a prompt owned by the calling wallet.

## Account And Auth Flow

### Challenge token

`POST /api/unlock/challenge`

Issues a short-lived challenge token for wallet verification.

### Unlock prompt

`POST /api/unlock/verify`

Verifies the wallet signature and on-chain entitlement before returning decrypted content.

## Notes For Frontend Contributors

- Listing metadata is normalized server-side before persistence.
- Category casing is canonicalized so the frontend can send user-friendly values.
- The buyer dashboard reads from `/api/prompts/buyer/:walletAddress/saved` and `/api/prompts/buyer/:walletAddress/owned` to populate separate library sections.
- Save and unsave actions are intentionally idempotent from the UI perspective.
