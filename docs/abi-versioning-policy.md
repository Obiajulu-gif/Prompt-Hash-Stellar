# ABI Versioning Policy

## Overview

This document defines the versioning policy for the PromptHash Stellar contract ABI (Application Binary Interface) and how clients (SDK, API, frontend) should handle compatibility across different contract versions.

## Version Numbering

### Contract Versioning

Contract versions follow semantic versioning (SemVer): `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes that require client updates
- **MINOR**: Backward-compatible additions
- **PATCH**: Bug fixes and internal improvements

### Client Versioning

Client components (SDK, API, frontend) also follow SemVer and are coupled to contract versions:

- **SDK**: `MAJOR.MINOR.PATCH` - Tracks contract compatibility
- **API**: `MAJOR.MINOR.PATCH` - Tracks contract compatibility  
- **Frontend**: `MAJOR.MINOR.PATCH` - Tracks SDK compatibility

## Compatibility Matrix

### Contract Changes → Client Impact

| Contract Change | SDK Impact | API Impact | Frontend Impact |
|----------------|------------|-----------|-----------------|
| **MAJOR** | MAJOR bump required | MAJOR bump required | Breaking changes required |
| **MINOR** | MINOR bump recommended | Optional feature support | Feature detection recommended |
| **PATCH** | No changes required | No changes required | No changes required |

### SDK Changes → Frontend Impact

| SDK Change | Frontend Impact |
|------------|-----------------|
| **MAJOR** | Breaking changes required |
| **MINOR** | Optional feature updates |
| **PATCH** | No changes required |

## Breaking Changes

A contract MAJOR version bump is required when:

1. **Function Removal**: Removing or renaming public contract functions
2. **Parameter Changes**: Changing function parameter types or order
3. **Return Type Changes**: Changing function return types
4. **Error Code Changes**: Modifying existing error code numbers
5. **Event Changes**: Removing events or changing event field types
6. **Struct Changes**: Removing fields from public structs
7. **Enum Changes**: Removing enum variants

## Backward-Compatible Additions

A contract MINOR version bump is appropriate when:

1. **New Functions**: Adding new public contract functions
2. **New Events**: Adding new event types
3. **New Error Codes**: Adding new error codes (preserving existing codes)
4. **Struct Additions**: Adding optional fields to structs
5. **Enum Additions**: Adding new enum variants
6. **New Features**: Adding entirely new features (bundles, access passes, etc.)

## Patch Releases

A contract PATCH version bump is appropriate when:

1. **Bug Fixes**: Fixing bugs without changing the ABI
2. **Performance**: Performance improvements without ABI changes
3. **Documentation**: Documentation updates
4. **Internal Changes**: Internal refactoring without ABI impact

## Client Compatibility Requirements

### SDK Compatibility

The SDK must declare the minimum contract version it supports:

```typescript
export const MIN_CONTRACT_VERSION = "0.0.1";
export const MAX_CONTRACT_VERSION = "0.1.0";
```

The SDK should:
- Validate contract version at initialization
- Provide feature detection for MINOR additions
- Fail gracefully for incompatible MAJOR versions
- Support a range of contract versions when possible

### API Compatibility

The API must:
- Validate contract version before operations
- Provide version endpoints for client compatibility checks
- Maintain backward compatibility for supported contract versions
- Document deprecation timelines for breaking changes

### Frontend Compatibility

The frontend must:
- Check SDK version compatibility
- Use feature detection for optional features
- Provide graceful degradation for unsupported features
- Display appropriate error messages for incompatibility

## Migration Guide

### For Contract MAJOR Upgrades

1. **Review Breaking Changes**: Check the compatibility report for specific changes
2. **Update SDK**: Upgrade to the latest major SDK version
3. **Update API**: Upgrade API to support new contract version
4. **Update Frontend**: Update frontend to use new SDK version
5. **Test Integration**: Run full integration tests
6. **Deploy Gradually**: Deploy with feature flags if possible
7. **Monitor**: Monitor for compatibility issues in production

### For Contract MINOR Upgrades

1. **Review Additions**: Check for new features that may be useful
2. **Optional SDK Update**: Update SDK to access new features
3. **Feature Detection**: Add feature detection for new capabilities
4. **Test New Features**: Test new features before enabling
5. **Gradual Rollout**: Enable new features gradually

### For Contract PATCH Upgrades

1. **Review Fixes**: Check for bug fixes that may affect your integration
2. **No Changes Required**: Typically no client changes needed
3. **Monitor**: Monitor for any unexpected behavior

## Compatibility Report

The compatibility report (`tests/abi-conformance/fixtures/compatibility-report.json`) provides:

- Contract version status (current, deprecated, etc.)
- Breaking changes between versions
- New additions in each version
- Minimum client version requirements
- Upgrade paths between versions
- Known issues and workarounds

Generate the report with:

```bash
node tests/abi-conformance/scripts/compatibility-report.ts
```

## ABI Conformance Testing

### Running Tests

Run the full ABI conformance test suite:

```bash
npm test -- tests/abi-conformance/validators/
```

### Regenerating Fixtures

When the contract ABI changes, regenerate the fixtures:

```bash
node tests/abi-conformance/scripts/generate-fixtures.ts
```

This will:
- Load the latest contract specification
- Generate updated canonical ABI fixtures
- Compare with existing fixtures
- Report any changes detected

### CI Integration

The CI pipeline automatically:
- Runs ABI conformance tests on contract changes
- Fails if fixtures are not up to date
- Generates compatibility reports
- Checks for uncommitted fixture changes

## Error Handling

### Contract Version Mismatch

When a client detects an incompatible contract version:

1. **SDK**: Throw clear error with version information
2. **API**: Return 426 Upgrade Required with version details
3. **Frontend**: Display user-friendly error with upgrade instructions

### Feature Detection

For MINOR additions, use feature detection:

```typescript
const supportsBundles = await sdk.hasFeature('bundles');
if (supportsBundles) {
  // Use bundle features
}
```

### Graceful Degradation

When features are not available:

1. Hide UI elements for unsupported features
2. Provide fallback behavior where possible
3. Clear error messages for required features
4. Document minimum requirements

## Best Practices

1. **Always Read Compatibility Reports**: Before upgrading, review the compatibility report
2. **Test Thoroughly**: Test all integrations after contract upgrades
3. **Use Feature Detection**: Don't assume features are available
4. **Monitor Production**: Watch for compatibility issues after upgrades
5. **Keep SDK Updated**: Stay within supported version ranges
6. **Document Custom Integrations**: Document any custom ABI handling
7. **Plan for Upgrades**: Include upgrade planning in development cycles

## Support Policy

### Supported Contract Versions

- **Current Version**: Full support
- **Previous Major Version**: Security fixes only
- **Older Versions**: No support

### Deprecation Timeline

- **MAJOR Deprecation**: 6 months notice
- **MINOR Deprecation**: 3 months notice
- **PATCH Deprecation**: No notice (always compatible)

### Emergency Breaking Changes

In rare cases of critical security issues, breaking changes may be deployed with:

- Immediate notification
- Emergency migration guide
- Extended support for previous version
- Coordination with major integrators

## References

- [ABI Conformance Tests](../tests/abi-conformance/)
- [Contract Specification](../contracts/prompt-hash/spec-baseline.json)
- [SDK Documentation](../packages/sdk/)
- [API Documentation](../server/)
- [Issue #433](https://github.com/Benalex8797/Prompt-Hash-Stellar/issues/433)
