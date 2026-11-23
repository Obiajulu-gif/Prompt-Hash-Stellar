# Security-session invalidation and rollback verification

Security events invalidate sessions issued at or before the event cutoff;
sessions issued later remain valid after re-authentication. The cutoff is
inclusive, and unauthorized actors cannot create or reverse a revocation.

Release rollback verification is fail-closed: migration rollback, smoke
verification, and authorization evidence must all be present before a release
is considered ready. Operators should correct the failed gate and rerun the
readiness self-test before retrying a deployment.
