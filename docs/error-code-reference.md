# Error Code Reference

Canonical source: [`src/lib/api/errorCodes.ts`](../src/lib/api/errorCodes.ts)

| Code | Layer | HTTP | Meaning | User message | Recovery |
|---|---|---|---|---|---|
| `MISSING_FIELDS` | API | 400 | Required request fields absent | "Some required fields are missing. Please check your request." | Re-send with all required fields. |
| `METHOD_NOT_ALLOWED` | API | 405 | Wrong HTTP method | "This action is not supported." | Use POST. |
| `CHALLENGE_EXPIRED` | Auth | 400 | Challenge token TTL elapsed | "Your session has expired. Click Decrypt Content to try again." | Request a new challenge. |
| `CHALLENGE_INVALID` | Auth | 400 | Token signature/address mismatch | "The unlock session is no longer valid. Click Decrypt Content to start over." | Request a new challenge. |
| `INVALID_SIGNATURE` | Auth | 401 | Wallet signature rejected | "Wallet signature did not match. Open your wallet and try signing again." | Re-sign in wallet. |
| `ACCESS_NOT_PURCHASED` | Contract | 403 | Wallet has no purchase record | "You have not purchased access to this prompt. Complete a purchase first." | Purchase the prompt first. |
| `RATE_LIMIT_IP` | Infra | 429 | IP bucket exceeded | "Too many requests. Please wait a moment, then try again." | Wait for reset, retry. |
| `RATE_LIMIT_WALLET` | Infra | 429 | Wallet bucket exceeded | "Too many unlock attempts for this wallet. Please wait a minute and try again." | Wait for reset, retry. |
| `CONFIGURATION_ERROR` | Server | 500 | Missing server secrets | "Something went wrong on our end. Please try again later." | Check env config (never expose to user). |
| `INTEGRITY_FAILURE` | Crypto | 500 | Plaintext hash ≠ stored hash | "Prompt content could not be verified. Please contact support if this persists." | Report to support. |
| `TEMPORARY_FAILURE` | Server | 500 | Transient backend error | "A temporary error occurred. Please try again in a moment." | Retry after a short delay. |

## Frontend error classification

The `classifyUnlockError()` function groups errors into three UI categories:

- **wallet** — signing, connection, or balance issues → show wallet recovery guidance
- **access** — purchase or permission issues → link to purchase flow
- **server** — backend failures → show retry button

## Adding a new error code

1. Add the constant to `ErrorCode` in `src/lib/api/errorCodes.ts`.
2. Add a user-facing message to `ERROR_MESSAGES`.
3. Update this table.
4. Add tests for the new code in the relevant test file.
