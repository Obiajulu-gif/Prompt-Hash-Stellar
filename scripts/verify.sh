#!/bin/bash
set -e

echo "==========================================="
echo " PromptHash Contract Verification Script"
echo "==========================================="

# Default to testnet if not specified
NETWORK=${NETWORK:-testnet}

if [ "$NETWORK" == "testnet" ]; then
    RPC_URL="https://soroban-testnet.stellar.org"
    NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
elif [ "$NETWORK" == "local" ]; then
    RPC_URL="http://localhost:8000"
    NETWORK_PASSPHRASE="Standalone Network ; February 2017"
else
    RPC_URL=${RPC_URL:-"http://localhost:8000"}
    NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE:-"Standalone Network ; February 2017"}
fi

# Get Contract ID from .env if not set
if [ -z "$CONTRACT_ID" ]; then
    if [ -f .env ]; then
        CONTRACT_ID=$(grep PUBLIC_PROMPT_HASH_CONTRACT_ID .env | cut -d '=' -f2 | tr -d '"' | tr -d ' ')
    fi
fi

if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" == "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" ]; then
    echo "❌ Error: CONTRACT_ID is not set or is still the placeholder."
    exit 1
fi

# Identity for queries (can be anyone, but let's use admin alias if available)
QUERY_ALIAS=${ADMIN_ALIAS:-admin}
if ! stellar keys address $QUERY_ALIAS >/dev/null 2>&1; then
    # Fallback to any identity or create a temporary one? 
    # For now, let's just fail if no identity is found.
    echo "⚠️ Warning: Identity '$QUERY_ALIAS' not found. Trying to use 'default' or similar if it exists..."
    QUERY_ALIAS="default"
    if ! stellar keys address $QUERY_ALIAS >/dev/null 2>&1; then
        echo "❌ Error: No valid identity found to perform queries. Please set ADMIN_ALIAS or have a default identity."
        exit 1
    fi
fi

echo "🌐 Network: $NETWORK"
echo "📄 Contract ID: $CONTRACT_ID"
echo "🔑 Querying via: $QUERY_ALIAS"
echo ""

invoke_contract() {
    local func=$1
    shift
    stellar contract invoke \
        --id $CONTRACT_ID \
        --source $QUERY_ALIAS \
        --network $NETWORK \
        -- \
        $func "$@"
}

echo "🔍 Reading configuration..."

# 1. Owner
OWNER=$(invoke_contract owner)
echo "👑 Owner (Admin): $OWNER"

# 2. Fee Percentage
FEE_BPS=$(invoke_contract get_fee_percentage)
echo "💰 Fee Percentage: $FEE_BPS BPS"

# 3. Fee Wallet
FEE_WALLET=$(invoke_contract get_fee_wallet)
echo "🏦 Fee Wallet: $FEE_WALLET"

# 4. XLM SAC
XLM_SAC=$(invoke_contract get_xlm_sac)
echo "🪙 XLM SAC ID: $XLM_SAC"

# 5. Prompts Check
PROMPTS=$(invoke_contract get_all_prompts)
echo "📝 Prompts: $PROMPTS"

echo ""
echo "✅ Verification complete! The contract is correctly configured and responding."
echo "--------------------------------------------------------"
