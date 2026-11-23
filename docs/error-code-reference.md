# Error Code Reference

Canonical sources:

- Codes and user messages: [`src/lib/api/errorCodes.ts`](../src/lib/api/errorCodes.ts)
- Taxonomy (statuses, titles, remediation, retry): [`src/lib/api/problemDetails.ts`](../src/lib/api/problemDetails.ts)
- Drift tests: [`src/test/problemDetails.test.ts`](../src/test/problemDetails.test.ts)

Every API error carries a stable machine `code`. The code, its allowed HTTP statuses, and its user message are a public contract: integrators branch on `code`, never on message text.

## Response formats

**Default (unchanged, legacy):**

```json
{ "error": "Wallet signature did not match. Open your wallet and try signing again.", "code": "INVALID_SIGNATURE" }
```

`reset` (429) and `correlationId` are added when applicable.

**Opt-in RFC 9457 problem details**: send `Accept: application/problem+json`. The response uses that media type and the same HTTP status, and is a superset of the legacy body (it keeps `error` and `code`):

```json
{
  "type": "urn:prompthash:problem:INVALID_SIGNATURE",
  "title": "Invalid wallet signature",
  "status": 401,
  "detail": "Invalid wallet signature.",
  "instance": "urn:prompthash:request:req-123",
  "code": "INVALID_SIGNATURE",
  "error": "Invalid wallet signature.",
  "remediation": "Sign the exact challenge message with the wallet that requested it.",
  "retryable": true,
  "docs": "docs/error-code-reference.md#invalid_signature"
}
```

| Member | Stability |
|---|---|
| `type`, `code` | Never change for an existing problem. `type` is always `urn:prompthash:problem:<code>`. |
| `status` | One of the statuses listed below for that code. |
| `title`, `remediation`, `retryable`, `docs` | Stable text; may be reworded, never removed. |
| `detail` / `error` | Safe, user-displayable text. Handlers may pass a more specific safe message. |
| `instance` | Present when a request id is known. |

Endpoints currently using the shared helper `sendApiError`: `POST /api/auth/challenge`, `POST /api/auth/verify`. Others still return the legacy body only and adopt the helper as they are touched; no client change is required.

## Codes

| Code | HTTP | Title | User message | Remediation | Retry |
|---|---|---|---|---|---|
| `MISSING_FIELDS` | 400 | Missing required fields | "Some required fields are missing. Please check your request." | Send every required field and retry. | no |
| `INVALID_INPUT` | 400 | Invalid input | "Some of the information provided is not valid. Please check it and try again." | Correct the invalid field value and retry. | no |
| `VALIDATION_ERROR` | 400 | Validation failed | "The request could not be validated. Please check it and try again." | Fix the request body to match the documented schema and retry. | no |
| `STALE_REQUEST` | 400 | Stale request | "This request is too old. Please try again." | Regenerate the request with a current timestamp and retry. | yes |
| `METHOD_NOT_ALLOWED` | 405 | Method not allowed | "This action is not supported." | Use the HTTP method documented for this endpoint. | no |
| `NOT_FOUND` | 404 | Resource not found | "The requested item could not be found." | Check the identifier; the record may not exist. | no |
| `PROMPT_NOT_FOUND` | 404 | Prompt not found | "That prompt could not be found." | Check the prompt id; the listing may have been removed. | no |
| `CHALLENGE_EXPIRED` | 400 | Challenge expired | "Your session has expired. Click Decrypt Content to try again." | Request a new challenge and sign it promptly. | yes |
| `CHALLENGE_INVALID` | 400 | Challenge invalid | "The unlock session is no longer valid. Click Decrypt Content to start over." | Request a new challenge; do not reuse tokens across wallets or prompts. | yes |
| `INVALID_SIGNATURE` | 401 (also 400) | Invalid wallet signature | "Wallet signature did not match. Open your wallet and try signing again." | Sign the exact challenge message with the wallet that requested it. | yes |
| `UNAUTHORIZED` | 403 (also 401) | Not authorized | "You are not authorized to perform this action." | Authenticate with credentials that have permission for this action. | no |
| `ACCESS_NOT_PURCHASED` | 403 | Access not purchased | "You have not purchased access to this prompt. Complete a purchase first." | Purchase the prompt with this wallet, then retry. | no |
| `STALE_PROMPT_TERMS` | 409 | Prompt terms changed | "This prompt changed since you opened it. Refresh the prompt and sign again." | Re-fetch the prompt, review the new price or version, and sign again. | yes |
| `INVALID_STATE` | 409 | Invalid state for action | "This action isn't allowed from the item's current status." | Check the record's current status; perform an allowed transition instead. | no |
| `OPERATION_NOT_ALLOWED` | 400 | Operation not allowed | "This operation is not allowed right now." | This record cannot be modified this way; see the operation's documentation. | no |
| `PERMISSION_DIFF_REQUIRED` | 409 | Permission review required | "Review the permission changes before applying them." | Request a permission preview and submit its digest after review. | no |
| `STALE_PERMISSION_DIFF` | 409 | Permission preview is stale | "Permissions changed after review. Create and review a fresh preview." | Request and review a fresh permission preview before retrying. | yes |
| `IDEMPOTENCY_CONFLICT` | 409 | Idempotency key conflict | "This idempotency key was used with a different request. Please use a new key." | Use a new idempotency key for a different request body. | no |
| `DUPLICATE_EVENT` | 409 | Duplicate event | "This event has already been processed." | No action needed; the event was already processed. | no |
| `RATE_LIMIT_IP` | 429 | Rate limit exceeded (IP) | "Too many requests. Please wait a moment, then try again." | Wait until the reset time, then retry with backoff. | yes |
| `RATE_LIMIT_WALLET` | 429 | Rate limit exceeded (wallet) | "Too many unlock attempts for this wallet. Please wait a minute and try again." | Wait about a minute, then retry with backoff. | yes |
| `RATE_LIMIT_ENTITLEMENT` | 429 | Rate limit exceeded (prompt) | "Too many unlock attempts for this prompt. Please wait a moment and try again." | Wait a moment before retrying unlock for this prompt. | yes |
| `CONFIGURATION_ERROR` | 500 | Server configuration error | "Something went wrong on our end. Please try again later." | Not caused by the request. Contact the operator; see docs/environments.md. | no |
| `INTEGRITY_FAILURE` | 500 | Content integrity check failed | "Prompt content could not be verified. Please contact support if this persists." | Do not use the content. Report to support with the correlation id. | no |
| `TEMPORARY_FAILURE` | 500 (also 400, 401) | Temporary failure | "A temporary error occurred. Please try again in a moment." | Retry after a short delay; if it persists, report the correlation id. | yes |
| `INTERNAL_ERROR` | 500 | Internal error | "Something went wrong on our end. Please try again later." | Retry later; if it persists, report the correlation id. | yes |

"HTTP" lists the canonical status first. "also" statuses are legacy responses some endpoints still send; they are kept for compatibility and are the only other statuses a code may use.

### MISSING_FIELDS

One or more required request fields are missing or malformed.

### INVALID_INPUT

A request field is present but has an invalid value (webhooks, profile actions).

### VALIDATION_ERROR

The request body or payload failed schema validation.

### STALE_REQUEST

The request timestamp is outside the accepted window (replay protection).

### METHOD_NOT_ALLOWED

The HTTP method is not allowed on this endpoint.

### NOT_FOUND

No record matches the given identifier.

### PROMPT_NOT_FOUND

No prompt matches the given id.

### CHALLENGE_EXPIRED

The challenge token has expired. The client should request a new one.

### CHALLENGE_INVALID

The challenge token is invalid (bad signature, wrong address/promptId).

### INVALID_SIGNATURE

The wallet signature does not match the challenge message.

### UNAUTHORIZED

The caller is authenticated but not authorized for this action.

### ACCESS_NOT_PURCHASED

The wallet has not purchased access to this prompt.

### STALE_PROMPT_TERMS

The prompt price or version changed after the wallet challenge was issued.

### INVALID_STATE

The action isn't allowed from the resource's current state (Issue #786: lifecycle transitions).

### OPERATION_NOT_ALLOWED

The operation is understood but not permitted for this record right now.

### PERMISSION_DIFF_REQUIRED

A permission update must include the digest from the preview that the admin reviewed.

### STALE_PERMISSION_DIFF

The permission state or requested change differs from the reviewed preview; produce a new preview and obtain review again.

### IDEMPOTENCY_CONFLICT

The idempotency key was reused with conflicting request data.

### DUPLICATE_EVENT

The event was already processed (inbound webhook de-duplication).

### RATE_LIMIT_IP

Too many requests from this IP address.

### RATE_LIMIT_WALLET

Too many requests from this wallet address.

### RATE_LIMIT_ENTITLEMENT

Too many unlock attempts for a specific prompt (buyer/prompt/failure scope).

### CONFIGURATION_ERROR

The server is missing required configuration (never expose details).

### INTEGRITY_FAILURE

Prompt content integrity check failed (hash mismatch).

### TEMPORARY_FAILURE

A temporary backend failure occurred. The client may retry.

### INTERNAL_ERROR

An unexpected server failure (never expose details).

## Frontend error classification

The `classifyUnlockError()` function groups errors into three UI categories:

- **wallet**: signing, connection, or balance issues → show wallet recovery guidance
- **access**: purchase or permission issues → link to purchase flow
- **server**: backend failures → show retry button

`getUnlockErrorMeta()` (`src/lib/errors/unlockErrors.ts`) maps every code to a category, retry hint, and i18n key. Strings live under `unlockErrors.codes.<CODE>` in all four locales.

## Adding or changing a code

1. Add the constant to `ErrorCode` and a message to `ERROR_MESSAGES` in `src/lib/api/errorCodes.ts`.
2. Add its entry to `PROBLEMS` in `src/lib/api/problemDetails.ts`.
3. Add it to `UNLOCK_ERROR_META` and to `unlockErrors.codes` in `en`, `es`, `fr`, `zh`.
4. Add it to the golden contract in `src/test/problemDetails.test.ts` and to the table and headings above (keep the row format; the tests parse it).
5. Send it with `sendApiError(req, res, code, message, { status })` using an allowed status.

Permission preview failures also expose `PermissionDiffError.apiCode` for HTTP
adapters: `diff_required` maps to `PERMISSION_DIFF_REQUIRED`, and `stale_diff`
maps to `STALE_PERMISSION_DIFF`. Keep the internal `.code` for service-level
branching; serialize the stable API code at the transport boundary.

The tests fail if a handler references a code that does not exist, sends a code with a status the taxonomy does not allow, or if the registry, messages, docs, or locales disagree.

## Operational edge cases and failure modes

- **Previously undefined codes**: handlers referenced `INVALID_INPUT`, `VALIDATION_ERROR`, `STALE_REQUEST`, `NOT_FOUND`, `OPERATION_NOT_ALLOWED`, `DUPLICATE_EVENT`, and `INTERNAL_ERROR` before they existed in `ErrorCode`, so those responses omitted `code` entirely. They now include it. Clients that matched on a missing `code` should match on status instead.
- **Legacy statuses**: `TEMPORARY_FAILURE` is returned with 400/401 by some auth/unlock paths and 500 by others; `INVALID_SIGNATURE` with 401 or 400; `UNAUTHORIZED` with 403 or 401. These are frozen, not endorsed. Changing one is a breaking change and needs a migration note.
- **Unknown codes**: clients must treat an unrecognized `code` as non-fatal and fall back to the HTTP status class. Never parse `detail`.
- **`CONFIGURATION_ERROR` and `INTERNAL_ERROR`** never carry internal details. Use the correlation id and server logs to diagnose (`docs/INCIDENT_RUNBOOK.md`).
- **Mocks and proxies** that omit `headers` are safe: the helper falls back to the legacy body.
- **Content type**: only the opt-in path changes `Content-Type`. Clients that call `response.json()` work with both.

## Rollback and recovery

- The taxonomy is additive. To roll back the helper, revert `api/auth/verify.ts` and `api/auth/challenge.ts` to `res.status(n).json(apiError(...))`; bodies are identical in the default path, so no client is affected.
- If a code or status change shipped by mistake, restore the previous value in `ErrorCode`/`PROBLEMS` and the golden table together; the tests will confirm the registry, docs, and locales agree again.
- If a locale string is wrong, fix it in `src/i18n/locales/<lang>.json`. Only the English text is pinned to `ERROR_MESSAGES`.
