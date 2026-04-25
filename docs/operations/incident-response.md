# Incident Response Guide: Unlock Services

This guide documents how to handle security or operational incidents related to the wallet-authenticated unlock services.

## Common Incident Types

### 1. Elevated Unlock Failures
- **Symptoms**: High volume of `unlock_failure_total` metrics or 4xx/5xx responses on `/api/prompts/unlock`.
- **Debugging**:
  - Check structured logs for `requestId`.
  - Look for `reason` label in failure metrics (e.g., `invalid_signature`, `no_access`, `integrity_failure`).
  - Verify Stellar RPC health and indexing lag.

### 2. Rate Limit Abuse
- **Symptoms**: Influx of 429 status codes.
- **Debugging**:
  - Identify the top `clientIp` or `wallet` from logs.
  - If a single entity is causing high traffic, consider manual IP blocking at the CDN level.
  - Review if rate limits need adjustment in `src/lib/observability/rateLimiter.ts`.

### 3. Prompt Integrity Failures
- **Symptoms**: Logs showing `Prompt integrity check failed`.
- **Debugging**:
  - This indicates a mismatch between the decrypted content and the registered hash on-chain.
  - Check if the `UNLOCK_PRIVATE_KEY` has been rotated incorrectly.
  - Verify if the prompt data on-chain matches the expected format.

## Troubleshooting Flow

1. **Locate Request ID**: Get the `requestId` from the user or from frontend error logs.
2. **Search Logs**: Use the `requestId` to find the full trace in the backend logs.
3. **Check Redacted Data**: If you need to see "redacted" data for debugging (rare), you must do so in a secure environment with original data access; logs will *not* contain plaintext.
4. **Verify On-Chain State**: Use the Stellar Lab or Soroban CLI to check the `has_access` status for the wallet and prompt ID.

## Unlock key and challenge secret incidents

### Key or secret compromise
- If `UNLOCK_PRIVATE_KEY` or `CHALLENGE_TOKEN_SECRET` may be compromised, rotate immediately.
- Deploy a new keypair and update `UNLOCK_KEY_VERSION`, `UNLOCK_PUBLIC_KEY`, and `UNLOCK_PRIVATE_KEY` for the current version.
- If older prompt listings must remain decryptable, keep the previous version in `UNLOCK_PUBLIC_KEYS` / `UNLOCK_PRIVATE_KEYS` until all legacy prompts are migrated or re-encrypted.
- Remove any compromised secret from `CHALLENGE_TOKEN_PREVIOUS_SECRETS` and deploy a fresh `CHALLENGE_TOKEN_SECRET`.

### Emergency revocation path
- Mark the unlock endpoint unhealthy in your deployment if necessary.
- Rotate the challenge secret first to invalidate all active challenge tokens.
- Rotate the unlock keypair and publish the new public key for future listings.
- Maintain an overlap window where both the current and previous unlock key versions are available so existing prompt listings still decrypt successfully.

## Escalation
- Contact the backend security lead if `integrity_failure` is widespread (potential key compromise).
- Contact the infrastructure team if Stellar RPC is consistently returning 5xx.
