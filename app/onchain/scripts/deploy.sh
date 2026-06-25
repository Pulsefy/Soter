#!/usr/bin/env bash
set -e

# Deploy script for Soroban contracts
# Usage: ./scripts/deploy.sh [--network testnet|futurenet|standalone] [--contract <name>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Deploying Soroban contract..."

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

# Default values
NETWORK="${NETWORK:-testnet}"
CONTRACT_NAME="${CONTRACT_NAME:-aid_escrow}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --contract)
            CONTRACT_NAME="$2"
            shift 2
            ;;
        *)
            echo "❌ Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate network
case "$NETWORK" in
    testnet|futurenet|standalone)
        echo "🌐 Using network: $NETWORK"
        ;;
    *)
        echo "❌ Invalid network: $NETWORK. Use testnet, futurenet, or standalone"
        exit 1
        ;;
esac

# Set RPC URL based on network
case "$NETWORK" in
    testnet)
        RPC_URL="${TESTNET_RPC_URL:-https://soroban-testnet.stellar.org:443}"
        ;;
    futurenet)
        RPC_URL="${FUTURENET_RPC_URL:-https://rpc-futurenet.stellar.org:443}"
        ;;
    standalone)
        RPC_URL="${STANDALONE_RPC_URL:-http://localhost:8000/soroban/rpc}"
        ;;
esac

# Check for secret key
if [ -z "$SECRET_KEY" ] && [ -z "$DEPLOYER_SECRET_KEY" ]; then
    echo "❌ No secret key found. Set SECRET_KEY or DEPLOYER_SECRET_KEY in .env"
    exit 1
fi

SECRET_KEY="${SECRET_KEY:-$DEPLOYER_SECRET_KEY}"

# Check if contract is built
WASM_FILE="target/wasm32v1-none/release/${CONTRACT_NAME}.wasm"
if [ ! -f "$WASM_FILE" ]; then
    # Fallback: try legacy target path built by older toolchain versions
    LEGACY_WASM="target/wasm32-unknown-unknown/release/${CONTRACT_NAME}.wasm"
    if [ -f "$LEGACY_WASM" ]; then
        WASM_FILE="$LEGACY_WASM"
        echo "⚠️  Using legacy wasm32-unknown-unknown artifact. Consider rebuilding with Stellar CLI 26+."
    else
        echo "❌ Contract not built: $WASM_FILE"
        echo "   Run 'stellar contract build' or './scripts/build.sh' first"
        exit 1
    fi
fi

# Extract contract version
CONTRACT_VERSION=$(grep '^version =' "contracts/${CONTRACT_NAME}/Cargo.toml" | head -1 | awk -F'"' '{print $2}')
if [ -z "$CONTRACT_VERSION" ]; then
    CONTRACT_VERSION="unknown"
fi

echo "📦 Contract: $CONTRACT_NAME (v$CONTRACT_VERSION)"
echo "📄 WASM file: $WASM_FILE"
echo "🔑 Using key: ${SECRET_KEY:0:10}..."

# Deploy contract
echo ""
echo "📡 Deploying to $NETWORK..."

DEPLOY_OUTPUT=$(stellar contract deploy \
    --wasm "$WASM_FILE" \
    --source "$SECRET_KEY" \
    --network "$NETWORK" \
    2>&1 || true)

if echo "$DEPLOY_OUTPUT" | grep -q "error"; then
    echo "❌ Deployment failed:"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

# Extract contract ID
CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -o "Contract ID: [A-Za-z0-9]*" | cut -d' ' -f3)

if [ -n "$CONTRACT_ID" ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo "📋 Contract ID: $CONTRACT_ID"
    echo "🏷️  Contract Version: $CONTRACT_VERSION"
    echo ""
    echo "💡 Save this ID for future interactions:"
    echo "export CONTRACT_ID=\"$CONTRACT_ID\""
    
    # Update .env file with contract ID
    if [ -f "$PROJECT_DIR/.env" ]; then
        if grep -q "CONTRACT_ID=" "$PROJECT_DIR/.env"; then
            sed -i.bak "s|CONTRACT_ID=.*|CONTRACT_ID=$CONTRACT_ID|" "$PROJECT_DIR/.env"
        else
            echo "CONTRACT_ID=$CONTRACT_ID" >> "$PROJECT_DIR/.env"
        fi
        
        # Log contract version to .env
        if grep -q "CONTRACT_VERSION=" "$PROJECT_DIR/.env"; then
            sed -i.bak "s|CONTRACT_VERSION=.*|CONTRACT_VERSION=$CONTRACT_VERSION|" "$PROJECT_DIR/.env"
        else
            echo "CONTRACT_VERSION=$CONTRACT_VERSION" >> "$PROJECT_DIR/.env"
        fi
        
        echo "📝 Updated .env with contract ID and version"
    fi
else
    echo "⚠️  Could not extract contract ID from output:"
    echo "$DEPLOY_OUTPUT"
fi