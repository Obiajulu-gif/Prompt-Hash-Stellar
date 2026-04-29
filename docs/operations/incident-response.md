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
- Use a secure key custody tool or managed secret store to generate and store the new values.
- Deploy a new unlock keypair and update `UNLOCK_KEY_VERSION`, `UNLOCK_PUBLIC_KEY`, and `UNLOCK_PRIVATE_KEY` for the current version.
- If older prompt listings must remain decryptable, keep the previous version(s) in `UNLOCK_PUBLIC_KEYS` / `UNLOCK_PRIVATE_KEYS` until all legacy prompts are migrated or re-encrypted.
- Keep older challenge secrets in `CHALLENGE_TOKEN_PREVIOUS_SECRETS` only if existing tokens must stay valid during the transition.
- Remove any compromised secret from `CHALLENGE_TOKEN_PREVIOUS_SECRETS` and deploy a fresh `CHALLENGE_TOKEN_SECRET`.

### Emergency revocation path

1. Rotate the challenge secret first to invalidate active challenge tokens.
2. Publish a new unlock keypair and set `UNLOCK_KEY_VERSION` to the new version.
3. Update `PUBLIC_UNLOCK_PUBLIC_KEY` and `PUBLIC_UNLOCK_KEY_VERSION` for the browser so new prompts are encrypted with the current key.
4. Maintain an overlap window where both the current and previous unlock key versions are present in `UNLOCK_PUBLIC_KEYS` / `UNLOCK_PRIVATE_KEYS`.
5. Verify the unlock endpoint succeeds for current requests before removing old key material.
6. Once legacy prompts are migrated or re-encrypted, remove old key versions from the deployment configuration.

## Escalation
- Contact the backend security lead if `integrity_failure` is widespread (potential key compromise).
- Contact the infrastructure team if Stellar RPC is consistently returning 5xx.
