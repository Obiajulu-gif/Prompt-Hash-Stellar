# Governance-Updatable Compliance Rules Engine

## Overview
The Compliance Rules Engine enforces jurisdiction-specific investor caps, accreditation requirements, and transfer restrictions across primary issuance and secondary-market transfers.

## Core Features
1. **Governance Updatable**: Compliance rules are stored in a governed table updatable by authorized governance administrators without requiring contract redeployment.
2. **Dual-Stage Enforcement**: Rules are evaluated consistently at both primary issuance and every secondary transfer.
3. **Non-Punitive Post-Change Handling**: If a governance rule change causes an existing position holder to become non-compliant, the engine issues a 30-day forced-sale window for orderly secondary market divestment rather than executing an instant freeze.

## Testing
Run automated unit tests:
```bash
npx vitest run src/test/complianceRulesEngine.test.ts
```
