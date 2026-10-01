# Safe Public Permalink Architecture (#936)

## Overview

In Prompt Hash Stellar, public links must remain safe, predictable, and resilient when prompt listings and marketplace records are renamed, archived, restored, or restricted.

This document defines the canonical permalink specification, 301 redirect behavior for renamed records, and security barriers that prevent private data leaks through old or active links.

---

## Architecture & Core Concepts

### 1. Canonical Permalinks & Stable IDs

- **Canonical URL**: The authoritative URL where a record lives (e.g. `/prompts/42`).
- **Slug**: A human-friendly, normalized URL slug generated from the prompt title (e.g. `stellar-contract-auditor`).
- **Stable Identifiers**:
  - `onChainId`: Numeric or alphanumeric string identifying the listing on Soroban.
  - `_id`: Off-chain database identifier.
  - Both IDs remain immutable throughout the record lifecycle.

### 2. Record Lifecycle States

| State | Status Code | Public Behavior | Private Content Protection |
|---|---|---|---|
| **Active** | `200 OK` | Record is fully viewable at canonical URL. | Unpurchased prompt template (`content`) and ciphertext (`encryptedPrompt`) are strictly excluded. |
| **Renamed** | `301 Moved Permanently` | Old slug redirects immediately to the canonical URL via HTTP 301 and `Location` header. | Redirect responses return target metadata only; no raw prompt text. |
| **Archived** | `200 OK` | Public permalink displays safe archived notice/banner. Purchases are disabled. | Strips `content`, `encryptedPrompt`, and `moderationNotes`. |
| **Restored** | `200 OK` | Listing is reactivated as `published` and canonical permalink resumes normal operation. | Standard public projection. |
| **Restricted** | `403 Forbidden` | Access blocked by moderation. | **Critical Guarantee**: Old links and direct links return `403` with **zero** private content leaked. |
| **Deleted** | `410 Gone` | Permanent tombstone indicating deletion. | Zero record data returned. |

---

## Private Data Leak Prevention Safeguards

Historical URLs are an attractive target for attackers attempting to probe unmoderated caches or bypass state transitions. Prompt Hash Stellar enforces three defensive layers:

1. **Strict Sanitization Projection (`sanitizePromptRecord`)**:
   Public-facing permalink resolutions and index queries strictly omit sensitive internal attributes:
   - `content`: Plaintext prompt instructions (unlocked only by verified purchasers via `/api/prompts/unlock`).
   - `encryptedPrompt`: Stored ciphertext payload.
   - `moderationNotes`: Internal moderator reasoning and risk scoring.

2. **Old Link Moderation Enforcement**:
   When a user requests a record through a historical slug stored in `previousSlugs` / `redirectsFrom`:
   - If the target record is **restricted**, the system **aborts redirection** and yields `403 Forbidden` without returning any private data.
   - If the target record is **deleted**, the system yields `410 Gone`.

3. **Ownership-Aware Authorization Context**:
   Restricted records can only be viewed in the creator dashboard by the verified owner (`viewerWallet` check) or platform moderators/admins. Public visitors receive `403 Forbidden` with zero metadata.

---

## API Specifications

### Resolve Permalink

`GET /api/prompts/permalink/:identifier`
`GET /api/prompts/resolve/:identifier`

Resolves any record identifier, current slug, or historical slug.

#### Query Parameters:
- `identifier` (string, required): On-chain ID, database ID, current slug, or historical slug.
- `viewerWallet` (string, optional): Stellar public key of the requesting viewer.

#### Responses:

**Active Record (200 OK):**
```json
{
  "status": "active",
  "statusCode": 200,
  "canonicalUrl": "/prompts/42",
  "record": {
    "id": "660c0001",
    "onChainId": "42",
    "title": "Stellar Smart Contract Auditor",
    "slug": "stellar-smart-contract-auditor",
    "canonicalUrl": "/prompts/42",
    "previewText": "Analyze Soroban smart contracts for vulnerabilities.",
    "category": "Programming",
    "price": 25,
    "creatorWallet": "GBXYZ...",
    "lifecycleState": "published",
    "listingStatus": "published",
    "moderationStatus": "none"
  }
}
```

**Renamed Record (301 Moved Permanently):**
Headers: `Location: /prompts/42`, `Cache-Control: public, max-age=86400`
```json
{
  "status": "redirect",
  "statusCode": 301,
  "canonicalUrl": "/prompts/42",
  "targetId": "42",
  "targetSlug": "stellar-smart-contract-auditor",
  "message": "This record has been renamed. Redirecting to canonical URL."
}
```

**Archived Record (200 OK):**
```json
{
  "status": "archived",
  "statusCode": 200,
  "canonicalUrl": "/prompts/42",
  "isArchived": true,
  "record": { ... },
  "message": "This listing has been archived by the author and is no longer available for purchase."
}
```

**Restricted Record (403 Forbidden):**
```json
{
  "status": "restricted",
  "statusCode": 403,
  "canonicalUrl": "/prompts/42",
  "isRestricted": true,
  "reason": "Policy violation",
  "message": "This listing has been restricted by moderators and cannot be viewed."
}
```

**Deleted Record (410 Gone):**
```json
{
  "status": "deleted",
  "statusCode": 410,
  "canonicalUrl": "/prompts/42",
  "isDeleted": true,
  "message": "This listing has been deleted and is no longer available."
}
```

---

## Lifecycle Operations

### Rename Record
`POST /api/prompts/:promptId/rename`

Renames the listing, updates its canonical slug, appends the previous slug to `previousSlugs` and `redirectsFrom`, and records an audit event (`prompt_permalink_renamed`).

### Archive Record
`POST /api/prompts/:promptId/archive-permalink`

Transitions listing to `archived`, sets `archivedAt`, deactivates marketplace visibility, and logs `prompt_permalink_archived`.

### Restore Record
`POST /api/prompts/:promptId/restore-permalink`

Restores an archived listing to `published`, resets `archivedAt`, reactivates visibility, and logs `prompt_permalink_restored`.

### Restrict Record (Moderation)
`POST /api/prompts/:promptId/restrict-permalink`
*Requires `moderation:write` admin scope.*

Restricts listing, suspends lifecycle state, and logs `prompt_permalink_restricted`.

---

## Verification & Testing

Automated tests are located in:
- `server/src/tests/permalink.test.ts`
- `packages/schema/src/permalink.test.ts`

Run tests using:
```bash
corepack yarn vitest run server/src/tests/permalink.test.ts
corepack yarn vitest run packages/schema/src/permalink.test.ts
```
