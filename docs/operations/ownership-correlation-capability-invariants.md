# Ownership, correlation, and capability invariants

This change set pins three security boundaries that are easy to regress:

- ownership transfers remain two-step, authorize the current/pending owner,
  and reject acceptance after the stored deadline;
- request correlation IDs propagate through retries and preserve an explicitly
  supplied `X-Request-ID`/`X-Correlation-ID` instead of replacing it; and
- capability grants are valid only through their expiry boundary, are bound to
  the requested capability, and cannot be reused or extended after consumption
  or expiry.

Failed validation is fail-closed and does not grant ownership, access, or
authorization. A caller should obtain a fresh transfer deadline, request ID,
or capability grant before retrying.
