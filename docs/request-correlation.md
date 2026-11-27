# Request correlation IDs

Every API request receives an opaque correlation ID:

- `X-Correlation-ID` is the response header and is also attached to error bodies.
- Clients may provide `X-Correlation-ID` or the compatibility alias `X-Request-ID`.
- Valid IDs contain 1–128 characters from ASCII letters, digits, `.`, `_`, `:`, and `-`.
- Missing or unsafe IDs are replaced with a generated UUID.

Use the correlation ID to connect request-start/request-end logs and audit rows.
Do not include credentials or prompt content in the ID. If a request is retried,
reuse the same ID so duplicate attempts remain identifiable; retries also use the
idempotency key for mutation replay semantics.

Recovery: for lost logs or an omitted header, rerun the request and record the new
response header. Rotation/redeployment is safe because IDs are not persisted as
configuration and existing behavior is preserved. There is no migration or data
backfill; stored audit rows continue to use their existing request ID field.
