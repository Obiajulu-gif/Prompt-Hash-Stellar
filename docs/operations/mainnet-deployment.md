# Mainnet Deployment Guide

This guide provides step-by-step instructions for deploying the PromptHash Stellar application to the Stellar Mainnet.

## Prerequisites

Before deploying to mainnet, ensure you have:

- A funded Stellar mainnet account with sufficient XLM for deployment and initialization
- The Stellar CLI installed and configured
- Rust and Soroban SDK installed
- Access to the repository with all dependencies installed
- Completed testing on testnet/futurenet

## Safety Checks

**IMPORTANT**: Mainnet deployments involve real XLM and cannot be undone. Always:

1. Verify you're using the correct network before running deployment commands
2. Double-check all environment variables
3. Test thoroughly on testnet first
4. Ensure you have sufficient XLM for deployment fees
5. Backup all keys and configuration files

## Deployment Steps

### 1. Prepare Environment Configuration

Copy the mainnet environment template and configure it:

```bash
cp env.mainnet.example .env
```

Edit `.env` and replace all placeholder values:
- `PUBLIC_PROMPT_HASH_CONTRACT_ID`: Will be filled after deployment
- `PUBLIC_STELLAR_SIMULATION_ACCOUNT`: Your funded mainnet account
- `PUBLIC_UNLOCK_PUBLIC_KEY`: Your actual public key
- `CHALLENGE_TOKEN_SECRET`: Generate a secure random string
- `UNLOCK_PUBLIC_KEY`: Your unlock service public key
- `UNLOCK_PRIVATE_KEY`: Your unlock service private key
- `ADMIN_ROTATION_TOKEN`: Generate a secure random token (optional but recommended)

### 2. Configure Deployment Script

The deployment script supports mainnet via the `NETWORK` environment variable:

```bash
export NETWORK=mainnet
export RPC_URL=https://soroban-rpc.mainnet.stellar.org
export NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
export STELLAR_NETWORK=mainnet
export HORIZON_URL=https://horizon.stellar.org
```

### 3. Set Up Identities

Configure your admin and fee wallet identities:

```bash
export ADMIN_ALIAS=your_admin_alias
export FEE_WALLET_ALIAS=your_fee_wallet_alias
```

Ensure these identities are funded on mainnet. You cannot use friendbot on mainnet.

### 4. Deploy Contract

Run the deployment script:

```bash
NETWORK=mainnet ADMIN_ALIAS=your_admin_alias FEE_WALLET_ALIAS=your_fee_wallet_alias ./scripts/deploy.sh
```

The script will:
1. Build and optimize the contract
2. Ensure identities exist and are funded
3. Resolve the XLM SAC (Stellar Asset Contract)
4. Deploy the contract to mainnet
5. Initialize the contract with admin and fee wallet
6. Update environment files with the deployed contract ID

### 5. Verify Deployment

After deployment, verify the contract is working:

```bash
stellar contract invoke \
    --id YOUR_CONTRACT_ID \
    --source your_admin_alias \
    --network mainnet \
    -- \
    get_all_prompts
```

### 6. Deploy Frontend

Build and deploy the frontend:

```bash
npm run build
```

Deploy the `dist` folder to your hosting provider (Vercel, Netlify, etc.).

Configure your hosting provider with the environment variables from your `.env` file (excluding private keys).

### 7. Deploy Unlock Service

Deploy the serverless unlock service:

```bash
cd server
npm run build
```

Deploy to your serverless platform (Vercel, AWS Lambda, etc.) with the appropriate environment variables.

## Mainnet Fee Structure

Current fee structure for mainnet transactions:

- **Platform fee**: 5% of each sale (configurable in contract)
- **Deployment fee**: Approximately 10-50 XLM depending on contract size
- **Transaction fees**: Standard Stellar network fees (100 stroops per operation)
- **Storage fees**: Contract storage costs based on data size

## Safeguards

### Preventing Accidental Mainnet Deployments

The deployment script includes several safeguards:

1. **Network confirmation**: The script requires explicit `NETWORK=mainnet` to deploy to mainnet
2. **Environment checks**: Verifies required environment variables are set
3. **Dry-run mode**: Add `DRY_RUN=true` to test without actual deployment

### Using Dry-Run Mode

To test deployment without executing:

```bash
DRY_RUN=true NETWORK=mainnet ./scripts/deploy.sh
```

### Environment Variable Validation

The script validates that:
- All required environment variables are set
- The network is explicitly specified
- Admin and fee wallet addresses are valid Stellar addresses

## Post-Deployment Checklist

After deploying to mainnet:

- [ ] Verify contract is accessible via RPC
- [ ] Test prompt creation flow
- [ ] Test prompt purchase flow
- [ ] Verify unlock service is functioning
- [ ] Check analytics dashboard is displaying data
- [ ] Verify fee wallet is receiving platform fees
- [ ] Set up monitoring and alerting
- [ ] Configure backup procedures
- [ ] Document all deployed addresses and keys securely

## Troubleshooting

### Insufficient Funds

If you encounter "insufficient funds" errors:
- Ensure your admin account has enough XLM (minimum 100 XLM recommended)
- Check the current network fees
- Verify your account is funded on the correct network

### Contract Initialization Failures

If contract initialization fails:
- Verify the XLM SAC ID is correct for mainnet
- Check that admin and fee wallet addresses are valid
- Ensure the contract was deployed successfully

### Environment Variable Issues

If environment variables aren't being picked up:
- Verify `.env` file exists in the root directory
- Check that variable names match exactly
- Ensure no typos in variable values

## Rollback Procedure

In case of critical issues:

1. Pause the frontend (set maintenance mode)
2. Stop the unlock service
3. If contract has critical bugs, consider upgrading (see `contract-upgrades.md`)
4. Revert to previous deployment if available
5. Communicate with users about any issues

## Monitoring

Set up monitoring for:
- Contract RPC endpoint availability
- Unlock service response times
- Error rates in logs
- Transaction success rates
- Fee wallet balance

## Security Considerations

- Never commit `.env` files with real secrets
- Use strong, randomly generated secrets for production
- Implement proper secret rotation (see `secret-rotation.md`)
- Use rate limiting on the unlock service
- Monitor for suspicious activity
- Keep dependencies updated

## Support

For issues or questions:
- Check the troubleshooting section
- Review the architecture documentation
- Open an issue on GitHub
- Contact the development team
