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
