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

## User-Facing Degraded Dependency Status (#1144)

The frontend provides real-time, user-safe visibility into degraded dependency states via `DegradedDependencyBanner` and `useDegradedServiceStatus`:

### Behavior & Paths
- **Normal Path**: When all monitored dependencies (`ipfs`, `stellar_rpc`, `safety_scanner`) are healthy, no banner is rendered, and all marketplace operations proceed normally.
- **Failure Path (Degraded / Unavailable)**: When any dependency becomes degraded or unavailable, a prominent, accessible notification banner renders:
  - **Degraded**: Amber status banner with user-safe explanation and guidance (e.g. extended RPC transaction windows).
  - **Unavailable**: Rose/critical status banner informing users that critical mutating or financial operations are safely paused, while non-critical browsing remains functional.
- **Retry Path**: The banner includes a "Retry" button that polls service health probes and automatically clears the warning once dependencies recover.
- **Authorization / Privacy Path**: The component renders strictly pre-approved, safe customer copy from `DEFAULT_MESSAGES`. Raw error messages, internal IP addresses, stack traces, and database or RPC credentials are never surfaced to the client DOM.

### Rollback & Migration
- The banner is self-contained. To disable or roll back, simply remove `<DegradedDependencyBanner />` from `src/App.tsx`.
- No database migrations or contract changes are required. Existing contracts and APIs remain completely backward-compatible.
