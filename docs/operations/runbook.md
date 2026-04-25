# Runbook: Operating Unlock Services

## Monitoring & Metrics

We use structured logging to emit metrics. Key metrics to monitor:

- `challenge_issued_total`: Volume of unlock requests initiated.
- `unlock_success_total`: Successful prompt decryptions.
- `unlock_failure_total`: Failed attempts (labeled by reason).
- `rate_limit_hit_total`: Blocked requests (labeled by type).
- `api_request_duration_ms`: Latency of the unlock flow.

## Health Checks
The `/api/health` endpoint provides a basic signal of service availability.

## Rate Limiting Configuration
Default limits (defined in `src/lib/observability/rateLimiter.ts`):
- **Challenge**: 10 requests per minute per IP.
- **Unlock**: 5 requests per minute per IP/Wallet.

## Redaction Rules
The following fields are automatically redacted from logs:
- `plaintext`
- `secret`
- `privateKey`
- `signedMessage`
- Authorization headers

## Debugging Common Issues

### "Invalid wallet signature"
- Ensure the user's wallet is signing the exact message returned by the challenge endpoint.
- Verify that the nonce hasn't expired (default TTL: 5 minutes).

### "Prompt access has not been purchased"
- Check if the transaction for purchasing the prompt has been confirmed on the Stellar network.
- Ensure the indexer or RPC being used is up to date with the latest ledger.

## Emergency Pause (Circuit Breaker)

The contract supports a global pause mechanism. When activated, all state-changing user operations (`buy_prompt`, `create_prompt`, `set_prompt_sale_status`, `update_prompt_price`) return `Error::ContractPaused` (code 19).

### Pausing the Protocol

Use the Soroban CLI to invoke `pause` as the admin:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SECRET> \
  --network <NETWORK> \
  -- pause
```

### Verifying Pause State

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network <NETWORK> \
  -- is_paused
```

Returns `true` if paused, `false` otherwise.

### Unpausing the Protocol

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SECRET> \
  --network <NETWORK> \
  -- unpause
```

### Frontend/Backend Behavior During Pause

- **Frontend**: Should check `is_paused` before rendering purchase or listing forms. When a paused transaction fails, the error code `19` (`ContractPaused`) should be mapped to a user-facing incident message (e.g., "The marketplace is temporarily paused for maintenance. Please try again later.").
- **Backend unlock service**: Read-only operations (`has_access`) continue to work, so existing unlock flows for already-purchased prompts are unaffected. New purchases will be blocked.
- **Indexer**: `ProtocolPaused` and `ProtocolUnpaused` events are emitted and should be consumed for monitoring dashboards and alerting.

### Unpause Checklist

1. Verify the root cause of the incident has been resolved.
2. Confirm fee wallet and fee percentage are correctly configured.
3. Test a purchase on testnet if possible.
4. Invoke `unpause` via Soroban CLI.
5. Verify `is_paused` returns `false`.
6. Monitor first few transactions after unpause for errors.

