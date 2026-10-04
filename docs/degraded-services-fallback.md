# Third-Party Service Degraded Fallback Behavior

## Overview
When third-party dependencies experience degradation or outages, Prompt Hash Stellar transitions into deterministic fallback states rather than failing unpredictably.

## Supported Third-Party Services
1. **IPFS Storage (`ipfs`)**
   - **Healthy**: Full upload, pin, and fetch capabilities active.
   - **Degraded**: Secondary IPFS gateways utilized; user alerted of potential latency.
   - **Unavailable**: Unsafe write actions (`publish_prompt`, `upload_content`) are blocked. Read operations utilize cached local preview data.

2. **Stellar RPC & Horizon Node (`stellar_rpc`)**
   - **Healthy**: Full wallet transactions, contract balance lookups, and purchasing active.
   - **Degraded**: Transactions and RPC calls executed with extended timeout retry windows and user warning messages.
   - **Unavailable**: Unsafe financial actions (`buy_prompt`, `execute_payment`, `deploy_contract`) are strictly blocked.

3. **Content Safety Scanner (`safety_scanner`)**
   - **Healthy**: Instant automated scanning and publication.
   - **Degraded**: Asynchronous analysis queue active.
   - **Unavailable**: Instant publication blocked (`auto_publish_prompt`). All new submissions route to maintainer manual review queue.

## Observability Events
Fallback state transitions and action blockages emit structured observability events:
- `fallback_activated`: Emitted when a service enters `degraded` or `unavailable` state.
- `service_recovered`: Emitted when a service returns to `healthy` status.
- `critical_action_blocked`: Emitted when a user action is safely blocked due to service unavailability.
