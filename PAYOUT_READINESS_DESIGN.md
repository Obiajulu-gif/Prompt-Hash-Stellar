# Payout Readiness Validation Design

## Overview

This design adds creator readiness validation before allowing paid prompt publication, preventing creators from reaching publication flows without proper payout setup.

## Problem Statement

Currently, creators can publish paid prompts without:
- Configured payout destination
- Complete creator profile 
- Validated settlement readiness (XLM balance)

This leads to failed settlements and support cases when buyers purchase prompts from unprepared creators.

## Solution Architecture

### Core Components

1. **PayoutReadiness Validation System** (`src/lib/validation/payoutReadiness.ts`)
   - Centralized validation logic
   - Standardized check results with actionable feedback
   - Blocking vs. warning classifications

2. **React Hooks** (`src/hooks/usePayoutReadiness.ts`, `src/hooks/useCreatorProfile.ts`)
   - Real-time readiness monitoring
   - Integration with existing wallet and balance hooks
   - Automatic re-validation when dependencies change

3. **UI Components** (to be implemented)
   - Remediation checklist component
   - Blocking gate in CreatePromptForm
   - Enhanced payout settings page

### Validation Checks

#### 1. Wallet Connection (BLOCKING)
- **Pass**: Valid Stellar address connected
- **Fail**: No wallet or invalid address format
- **Action**: Connect/fix wallet

#### 2. Payout Destination (BLOCKING) 
- **Pass**: Valid Stellar address configured for payouts
- **Fail**: No payout address or invalid format
- **Warn**: Using same address for wallet and payouts (allowed but not recommended)
- **Action**: Configure payout address in settings

#### 3. Creator Profile (BLOCKING for required fields)
- **Pass**: Complete profile with display name and bio
- **Fail**: Missing required fields (display name, bio)
- **Warn**: Missing recommended fields (avatar, social links)
- **Action**: Complete profile

#### 4. Settlement Readiness (BLOCKING for insufficient balance)
- **Pass**: Sufficient XLM balance (≥1 XLM)
- **Fail**: Insufficient balance for transaction fees (<1 XLM)
- **Warn**: Low balance but sufficient (1-2 XLM)
- **Action**: Fund wallet

### Data Flow

```
1. User attempts to create paid prompt
2. CreatePromptForm calls usePayoutReadiness()
3. Hook aggregates data from:
   - useWallet() → address
   - useWalletBalance() → XLM balance  
   - useCreatorProfile() → profile data
   - localStorage → payout preferences
4. Validation runs with current data
5. Result determines UI state:
   - isReady = true → Allow submission
   - isReady = false → Show blocking checklist
```

### Integration Points

#### CreatePromptForm Changes
- Add payout readiness validation before form submission
- Display blocking checklist when validation fails
- Disable/hide publish button until readiness passes
- Maintain existing free/draft workflow (unchanged)

#### PayoutSettingsPage Enhancement  
- Integrate with readiness validation
- Show real-time validation status
- Provide clear feedback on configuration state

#### Remediation Checklist Component
- Display all validation checks with pass/fail/warn status
- Actionable links to fix each issue
- Progress tracking and celebration when complete

### Error Handling

- **Network errors**: Graceful degradation, warn user
- **Data loading**: Show loading states during validation
- **Storage errors**: Fall back to requiring manual verification
- **Invalid states**: Clear error messages with fix instructions

### Testing Strategy

1. **Unit Tests**: Each validation function with edge cases
2. **Integration Tests**: Hook behavior with different data states  
3. **E2E Tests**: Full user flow from unprepared to ready creator
4. **Edge Cases**: 
   - Missing payout configuration
   - Invalid payout addresses
   - Incomplete profiles
   - Insufficient balances
   - Network errors during validation

### Backward Compatibility

- **Free prompts**: No validation changes (if supported)
- **Draft workflows**: Remain available
- **Existing creators**: Grandfathered until next update
- **API**: No breaking changes to existing endpoints

### Future Enhancements

- **Multi-currency support**: Extend for other Stellar assets
- **Advanced payout methods**: Support for more complex routing
- **Creator verification**: Integration with identity verification
- **Reputation scoring**: Factor in creator trustworthiness
- **Batch validation**: Optimize for multiple simultaneous checks

## Implementation Plan

### Phase 1: Core Validation (Current)
- [x] PayoutReadiness validation system
- [x] React hooks for data management  
- [ ] CreatePromptForm integration
- [ ] Basic remediation checklist

### Phase 2: Enhanced UX
- [ ] Advanced remediation UI
- [ ] PayoutSettingsPage improvements
- [ ] Progress tracking and celebration

### Phase 3: Testing & Polish
- [ ] Comprehensive test suite
- [ ] Documentation updates
- [ ] Performance optimization

### Phase 4: Advanced Features
- [ ] Multi-currency support
- [ ] Advanced payout routing
- [ ] Creator verification integration

## Success Metrics

- **Reduced support tickets** related to failed settlements
- **Higher creator completion rates** for proper setup
- **Improved buyer experience** with fewer payment failures
- **Maintained conversion rates** for creator onboarding

## Risk Mitigation

- **Overly restrictive validation**: Warn instead of block for non-critical issues
- **Performance impact**: Lazy loading and caching of validation data
- **User friction**: Clear guidance and one-click fixes where possible
- **Data privacy**: Validation happens client-side, no additional tracking