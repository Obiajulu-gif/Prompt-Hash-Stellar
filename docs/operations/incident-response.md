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

### 4. Protocol Pause / Circuit Breaker
- **When to trigger**:
  - Active exploit detected affecting purchase flow or fund routing.
  - Fee wallet misconfiguration discovered (funds going to wrong address).
  - Purchase-flow bugs causing incorrect payment splits.
  - Backend unlock service compromise (pause prevents new purchases while investigating).
  - Indexer desynchronization causing inconsistent marketplace state.
- **How to pause**:
  - Invoke `pause` via Soroban CLI as the admin authority. See [runbook.md](./runbook.md#emergency-pause-circuit-breaker) for exact commands.
- **During pause**:
  - Verify `is_paused` returns `true`.
  - Read-only methods (`get_prompt`, `has_access`, etc.) continue to work — existing unlock flows are unaffected.
  - `buy_prompt`, `create_prompt`, `set_prompt_sale_status`, `update_prompt_price` will return `Error::ContractPaused` (code 19).
  - Admin can still invoke `set_fee_percentage`, `set_fee_wallet`, and `upgrade` to fix configuration or deploy patches.
  - Frontend should display a maintenance banner; map error code 19 to an incident message.
- **Unpause recovery**:
  1. Confirm root cause is resolved.
  2. Verify fee wallet and percentage configuration.
  3. Test on testnet if time permits.
  4. Invoke `unpause` via Soroban CLI.
  5. Monitor `ProtocolUnpaused` event emission and first post-pause transactions.

## Troubleshooting Flow

1. **Locate Request ID**: Get the `requestId` from the user or from frontend error logs.
2. **Search Logs**: Use the `requestId` to find the full trace in the backend logs.
3. **Check Redacted Data**: If you need to see "redacted" data for debugging (rare), you must do so in a secure environment with original data access; logs will *not* contain plaintext.
4. **Verify On-Chain State**: Use the Stellar Lab or Soroban CLI to check the `has_access` status for the wallet and prompt ID.
5. **Check Pause State**: If users report blanket failures across all purchases, check `is_paused` to confirm whether the circuit breaker has been activated.

## Escalation
- Contact the backend security lead if `integrity_failure` is widespread (potential key compromise).
- Contact the infrastructure team if Stellar RPC is consistently returning 5xx.
- If a pause has been activated, notify the full engineering team and update the public status page.
