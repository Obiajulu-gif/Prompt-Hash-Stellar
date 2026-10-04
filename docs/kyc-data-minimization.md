# On-Chain KYC Data Minimization & Regulator Selective Disclosure

## Overview
To comply with regulatory audit requirements without exposing Personally Identifiable Information (PII) on public blockchains, the protocol utilizes zero-PII on-chain commitments coupled with access-controlled off-chain audit vaults.

## Design Architecture
1. **On-Chain Commitment**: Stored on-chain as a cryptographic commitment hash:
   $$\text{commitmentHash} = \text{SHA256}(\text{investorAddress} \parallel \text{piiHash} \parallel \text{salt} \parallel \text{eligibilityTier} \parallel \text{timestamp} \parallel \text{oracleSecret})$$
2. **On-Chain Purchase Enforcement**: At purchase time, eligibility checks verify only the non-PII `eligibilityTier`, oracle signature validity, and commitment expiration timestamp.
3. **Off-Chain Vault**: Raw PII is encrypted and stored in an off-chain compliance vault.
4. **Regulator Selective Disclosure**: Authorized regulators holding credentialed keys (`REGULATOR_AUTHORIZED_KEY_*`) can request selective disclosure packages for specific audit IDs.

## Testing
Run automated unit tests:
```bash
npx vitest run src/test/kycDataMinimization.test.ts
```
