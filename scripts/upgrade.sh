#!/bin/bash
set -e

echo "==========================================="
echo " PromptHash Contract Upgrade Script"
echo "==========================================="

# Default to testnet if not specified
NETWORK=${NETWORK:-testnet}

if [ "$NETWORK" == "testnet" ]; then
    RPC_URL="https://soroban-testnet.stellar.org"
    NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
    STELLAR_NETWORK="testnet"
elif [ "$NETWORK" == "local" ]; then
    RPC_URL="http://localhost:8000"
    NETWORK_PASSPHRASE="Standalone Network ; February 2017"
    STELLAR_NETWORK="local"
else
    RPC_URL=${RPC_URL:-"http://localhost:8000"}
    NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE:-"Standalone Network ; February 2017"}
    STELLAR_NETWORK=${STELLAR_NETWORK:-"custom"}
fi

# Ensure contract ID is provided or exists in env
if [ -z "$CONTRACT_ID" ]; then
    if [ -f .env ]; then
        CONTRACT_ID=$(grep PUBLIC_PROMPT_HASH_CONTRACT_ID .env | cut -d '=' -f2 | tr -d '"' | tr -d ' ')
    fi
fi

if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" == "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" ]; then
    echo "❌ Error: CONTRACT_ID is not set or is still the placeholder."
    echo "Please set it via CONTRACT_ID environment variable or in .env"
    exit 1
fi

# Admin identity
ADMIN_ALIAS=${ADMIN_ALIAS:-admin}

echo "🌐 Network: $NETWORK"
echo "📄 Contract ID: $CONTRACT_ID"
echo "🔑 Admin Alias: $ADMIN_ALIAS"

# Build and Optimize
echo ""
echo "📦 Building and optimizing new contract version..."
stellar contract build
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/prompt_hash.wasm

WASM_PATH="target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm"

# Install Wasm
echo ""
echo "⬆️ Installing new Wasm on network..."
WASM_HASH=$(stellar contract install \
    --wasm $WASM_PATH \
    --source $ADMIN_ALIAS \
    --network $NETWORK)

echo "✅ Installed Wasm with hash: $WASM_HASH"

# Invoke Upgrade
echo ""
echo "⚙️ Invoking upgrade on contract..."
stellar contract invoke \
    --id $CONTRACT_ID \
    --source $ADMIN_ALIAS \
    --network $NETWORK \
    -- \
    upgrade \
    --new_wasm_hash "$WASM_HASH"

echo "✅ Contract upgraded successfully!"

# Verification
echo ""
echo "🔍 Running post-upgrade verification..."
PROMPTS_COUNT=$(stellar contract invoke \
    --id $CONTRACT_ID \
    --source $ADMIN_ALIAS \
    --network $NETWORK \
    -- \
    get_all_prompts)

echo "✅ Upgrade verified. Current prompts count: $PROMPTS_COUNT"
echo "--------------------------------------------------------"
echo "Upgrade successful!"
echo "--------------------------------------------------------"

