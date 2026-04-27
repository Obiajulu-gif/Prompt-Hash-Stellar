#!/bin/bash
set -e

echo "==========================================="
echo " PromptHash Contract Deployment Script"
echo "==========================================="

# Default to testnet if not specified
NETWORK=${NETWORK:-testnet}
ENV_FILE=".env"
ENV_LOCAL_FILE=".env.local"

if [ "$NETWORK" == "testnet" ]; then
    RPC_URL="https://soroban-testnet.stellar.org"
    NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
    STELLAR_NETWORK="testnet"
    HORIZON_URL="https://horizon-testnet.stellar.org"
elif [ "$NETWORK" == "local" ]; then
    RPC_URL="http://localhost:8000"
    NETWORK_PASSPHRASE="Standalone Network ; February 2017"
    STELLAR_NETWORK="local"
    HORIZON_URL="http://localhost:8000"
else
    # Allow custom network via env vars if not testnet/local
    RPC_URL=${RPC_URL:-"http://localhost:8000"}
    NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE:-"Standalone Network ; February 2017"}
    STELLAR_NETWORK=${STELLAR_NETWORK:-"custom"}
    HORIZON_URL=${HORIZON_URL:-"http://localhost:8000"}
fi

# Identities
ADMIN_ALIAS=${ADMIN_ALIAS:-admin}
FEE_WALLET_ALIAS=${FEE_WALLET_ALIAS:-fee_wallet}

echo "🌐 Using network: $NETWORK ($STELLAR_NETWORK)"
echo "🔗 RPC URL: $RPC_URL"

# Build and Optimize
echo ""
echo "📦 Building and optimizing contract..."
stellar contract build
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/prompt_hash.wasm

WASM_PATH="target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm"

# Ensure identities exist and are funded
setup_identity() {
    local alias=$1
    if ! stellar keys address $alias >/dev/null 2>&1; then
        echo "Creating identity '$alias'..."
        stellar keys generate $alias --network $NETWORK
    fi
    
    local address=$(stellar keys address $alias)
    echo "Identity '$alias': $address"
    
    # Fund if local or testnet
    if [ "$NETWORK" == "local" ]; then
        echo "Funding '$alias' on local network..."
        curl -s "$RPC_URL/friendbot?addr=$address" > /dev/null || echo "Friendbot might have failed, continuing..."
    elif [ "$NETWORK" == "testnet" ]; then
        # Check if already funded, if not use friendbot
        # Simple check: just try friendbot, it's fast on testnet
        echo "Ensuring '$alias' is funded on testnet..."
        curl -s "https://friendbot.stellar.org?addr=$address" > /dev/null || echo "Friendbot might have failed, continuing..."
    fi
}

setup_identity $ADMIN_ALIAS
setup_identity $FEE_WALLET_ALIAS

ADMIN_ADDRESS=$(stellar keys address $ADMIN_ALIAS)
FEE_WALLET_ADDRESS=$(stellar keys address $FEE_WALLET_ALIAS)

# Handle XLM SAC
echo ""
echo "🔍 Resolving XLM SAC..."
if [ "$NETWORK" == "testnet" ]; then
    XLM_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
else
    # For local, we might need to deploy it if it doesn't exist
    stellar contract asset deploy --asset native --source $ADMIN_ALIAS --network $NETWORK > /dev/null 2>&1 || true
    XLM_SAC=$(stellar contract id asset --asset native --network $NETWORK)
fi
echo "XLM SAC ID: $XLM_SAC"

# Deploy
echo ""
echo "🚀 Deploying contract..."
CONTRACT_ID=$(stellar contract deploy \
    --wasm $WASM_PATH \
    --source $ADMIN_ALIAS \
    --network $NETWORK \
    --alias prompt_hash)

echo "✅ Deployed PromptHash contract with ID: $CONTRACT_ID"

# Initialize
echo ""
echo "⚙️ Initializing contract..."
stellar contract invoke \
    --id $CONTRACT_ID \
    --source $ADMIN_ALIAS \
    --network $NETWORK \
    -- \
    __constructor \
    --admin $ADMIN_ADDRESS \
    --fee_wallet $FEE_WALLET_ADDRESS \
    --xlm_sac $XLM_SAC

echo "✅ Contract initialized successfully!"

# Sync .env
echo ""
echo "📝 Synchronizing environment files..."

sync_env() {
    local file=$1
    if [ ! -f "$file" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example "$file"
        else
            touch "$file"
        fi
    fi

    # Update values (using a simple temp file to be portable)
    sed -i.bak "s|^PUBLIC_STELLAR_NETWORK=.*|PUBLIC_STELLAR_NETWORK=$(echo $STELLAR_NETWORK | tr '[:lower:]' '[:upper:]')|" "$file"
    sed -i.bak "s|^PUBLIC_STELLAR_NETWORK_PASSPHRASE=.*|PUBLIC_STELLAR_NETWORK_PASSPHRASE=\"$NETWORK_PASSPHRASE\"|" "$file"
    sed -i.bak "s|^PUBLIC_STELLAR_RPC_URL=.*|PUBLIC_STELLAR_RPC_URL=\"$RPC_URL\"|" "$file"
    sed -i.bak "s|^PUBLIC_STELLAR_HORIZON_URL=.*|PUBLIC_STELLAR_HORIZON_URL=\"$HORIZON_URL\"|" "$file"
    sed -i.bak "s|^PUBLIC_PROMPT_HASH_CONTRACT_ID=.*|PUBLIC_PROMPT_HASH_CONTRACT_ID=\"$CONTRACT_ID\"|" "$file"
    sed -i.bak "s|^PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID=.*|PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID=\"$XLM_SAC\"|" "$file"
    rm -f "$file.bak"
}

sync_env "$ENV_FILE"
sync_env "$ENV_LOCAL_FILE"

echo "✅ Environment files updated: $ENV_FILE, $ENV_LOCAL_FILE"

# Verification
echo ""
echo "🔍 Running basic verification..."
# Call a getter to ensure it works
PROMPTS_COUNT=$(stellar contract invoke \
    --id $CONTRACT_ID \
    --source $ADMIN_ALIAS \
    --network $NETWORK \
    -- \
    get_all_prompts)

echo "Current prompts count: $PROMPTS_COUNT"
echo "--------------------------------------------------------"
echo "Deployment successful!"
echo "Contract ID: $CONTRACT_ID"
echo "Admin: $ADMIN_ADDRESS"
echo "--------------------------------------------------------"

