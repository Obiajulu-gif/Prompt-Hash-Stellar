# Scoped Maintainer Impersonation Guide (Issue #834)

## Overview
Allows maintainers to reproduce user-reported bugs within strict security, scope, time, and audit boundaries.

## Security Constraints
- **Time-Limited**: Sessions expire after 30 minutes (configurable up to 60 minutes max).
- **Scoped**:
  - `READ_ONLY`: Blocks all non-GET requests.
  - `REPRODUCE_ISSUE`: Allows non-destructive issue reproduction.
  - `BILLING_VIEW`: Read-only access to user invoice/statement views.
- **Dangerous Mutations Blocked**: Financial transactions, prompt deletion, and credential changes are blocked unless elevated dual confirmation is provided.
- **Full Audit Trail**: Every session initiation, API invocation, and blocked mutation is recorded in `ImpersonationSession.auditTrail`.
