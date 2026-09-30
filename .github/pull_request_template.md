## Description
A clear and concise description of the changes in this PR. What problem does this solve?

## Related Issues
Closes #
Closes #

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Refactoring (no functional changes)

## Affected Components
- [ ] Frontend/UI
- [ ] Backend/Server
- [ ] Smart Contract
- [ ] Database/Models
- [ ] Tests
- [ ] Documentation

## Changes Made
Describe the specific changes made in this PR:
- Change 1
- Change 2
- Change 3

## Testing
Please describe the tests you ran to verify your changes:

### Manual Testing
- [ ] Tested in development environment
- [ ] Tested on multiple browsers/devices (if frontend)
- [ ] Tested with multiple wallet providers (if wallet integration)

### Automated Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] All tests passing locally (`npm test` / `cargo test`)
- [ ] No breaking changes to existing tests

## Screenshots/Video (if applicable)
Add screenshots or videos demonstrating the changes, especially for UI changes.

## Smart Contract Changes (if applicable)
- [ ] Contract state changes documented
- [ ] Event emissions updated
- [ ] Migration path provided (if upgrading existing contract)
- [ ] Backward compatibility verified
- [ ] Soroban test suite passes

## Database/Data Changes (if applicable)
- [ ] Database migration included
- [ ] Data model changes documented
- [ ] Backward compatibility verified
- [ ] Migration tested

## Security Considerations
- [ ] No new security vulnerabilities introduced
- [ ] Input validation added where needed
- [ ] Authentication/authorization verified (if applicable)
- [ ] Sensitive data handled securely
- [ ] No hardcoded secrets or credentials

## Breaking Changes
Does this PR introduce any breaking changes?
- [ ] No breaking changes
- [ ] Yes, breaking changes (describe below)

### Breaking Change Description
Describe the breaking changes and migration path:

## Wallet Integration (if applicable)
- [ ] Tested with Freighter
- [ ] Tested with Albedo
- [ ] Tested with other wallet providers: ___________
- [ ] Error handling for wallet disconnection
- [ ] Account switching handled correctly

## Documentation
- [ ] README updated (if needed)
- [ ] API documentation updated (if needed)
- [ ] Code comments added for complex logic
- [ ] CHANGELOG entry added (if applicable)

## Checklist
- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests passed locally with my changes
- [ ] Any dependent changes have been merged and published

## Release Readiness

> Skip this section for documentation-only or chore PRs. For any change touching contracts, auth, payout, migrations, or unlock — every item must be checked or have a documented exception below.
> Full criteria: [`docs/RELEASE_READINESS_CHECKLIST.md`](../docs/RELEASE_READINESS_CHECKLIST.md)

### Tests
- [ ] All existing tests pass locally (`yarn test`, `cargo test --all`, `yarn test:e2e`)
- [ ] New tests cover the happy path and at least one failure mode
- [ ] Concurrency-sensitive mutations have invariant tests under concurrent load
- [ ] Contract change: ABI conformance fixtures regenerated and committed

### Documentation
- [ ] `docs/openapi.json` updated for any API surface change
- [ ] New environment variables added to `.env.example` and `docs/environments.md`
- [ ] Breaking changes include a migration path description

### Migration
- [ ] Schema migration dry-run passes: `node scripts/migration-safety.mjs --dry-run`
- [ ] No irreversible data transforms without a rollback procedure in this PR

### Configuration
- [ ] New env vars have safe defaults or clear placeholders in `.env.example`
- [ ] Feature-flag guard added for large/risky rollouts

### Rollback
- [ ] Rollback plan described in this PR (feature flag, migration rollback, or revert tag)
- [ ] Contract upgrade: `scripts/preflight_upgrade.py check` passes

### Maintainer Sign-Off
- [ ] One maintainer approval (standard)
- [ ] Two maintainer approvals (contract or payout-path changes)

### Exception (if any checklist items are skipped)
Reason: <!-- P1 incident / CVE / regulatory -->
Incident ticket: <!-- link -->
Skipped items: <!-- list -->
Follow-up issue: <!-- link -->

---

## Additional Context
Add any other context about the PR here.

## Reviewer Notes
Any specific guidance for reviewers or areas to pay special attention to.
