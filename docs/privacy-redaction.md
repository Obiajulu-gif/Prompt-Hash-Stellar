# Privacy redaction for logs and exports

Operational logs use structured, privacy-safe fields and centralized recursive
redaction. Secrets, authorization values, private keys, prompt/completion bodies,
email addresses, and similar PII must be replaced by `[REDACTED]`. Log strings
are bounded and circular/deep object graphs are safely truncated.

Exports use strict field projection and deep redaction. Cross-user/admin exports
must not include raw wallet addresses, encrypted prompts, or lifecycle evidence
that is private to the owner. Owner exports may retain only explicitly approved
integrity fields, and CSV output neutralizes spreadsheet formula prefixes.

Edge cases:

- Malformed or nested payloads are still redacted; redaction never throws because
  of depth/cycles.
- Missing or retry payload fields do not invent values.
- Authorization failures produce no private record fields or denied reason details.
- Redaction is fail-closed: if a key is sensitive, its value is omitted even when
  the value appears benign.

Recovery: after an accidental exposure, revoke the credential, invalidate affected
sessions/exports, rotate secrets, purge logs/export artifacts, and create a new
export from approved fields. Reverting code without rotating exposed credentials
is not recovery. No database migration is required.
