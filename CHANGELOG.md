# Changelog

All notable changes to PromptHash Stellar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Payout Readiness Validation System
- **New requirement**: Creators must complete payout readiness validation before publishing paid prompts
- **4-step validation system**:
  1. Wallet Connection - Valid Stellar address connected
  2. Payout Destination - Configured address where earnings will be sent  
  3. Creator Profile - Complete profile with display name and bio (required)
  4. Settlement Readiness - Sufficient XLM balance for transaction fees (≥2.0 XLM)
- **Interactive UI components**:
  - `PayoutReadinessBanner` - Compact status display with quick actions
  - `PayoutReadinessChecklist` - Detailed interactive checklist with progress tracking
  - `PayoutReadinessPage` - Dedicated page for payout setup management
- **Enhanced CreatePromptForm**:
  - Real-time validation status display
  - Form submission blocking when setup incomplete
  - Actionable error messages with direct fix links
  - Preserved draft functionality during setup completion
- **Enhanced PayoutSettingsPage**:
  - Real-time payout address validation
  - Visual feedback with color-coded status indicators
  - Integration with readiness status display
  - Disabled save button for invalid configurations
- **New API functions**:
  - `validatePayoutReadiness()` - Core validation logic
  - `checkCreatorPayoutReadiness()` - Convenience wrapper
  - `usePayoutReadiness()` - React hook for state management
  - `usePayoutReadinessGate()` - Simplified hook for blocking checks
- **Comprehensive test coverage**:
  - Unit tests for validation logic with edge cases
  - React hook tests with mocked dependencies  
  - Component integration tests for UI interactions
  - End-to-end CreatePromptForm integration tests

### Changed
- **Creator onboarding flow**: Now requires profile completion and payout configuration before paid prompt publication
- **Documentation updates**: Updated creator-onboarding.md with new validation requirements and troubleshooting
- **Error handling**: Enhanced error messages throughout the flow with specific, actionable guidance

### Technical Details
- **Validation runs client-side** for immediate feedback
- **Real-time updates** when wallet balance or configuration changes
- **Graceful degradation** when validation services are unavailable
- **Preserves existing workflows** for draft saving and free prompts (if supported)
- **No breaking changes** to existing creator accounts - validation applies to new publications only

### Developer Impact
- New validation system integrates seamlessly with existing forms
- Comprehensive TypeScript interfaces for type safety
- Extensive test suite covers all acceptance criteria scenarios
- Clear separation of concerns between validation logic and UI components
- Detailed API documentation for integration guidance

---

*Previous changelog entries would go below this section*