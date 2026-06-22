#!/usr/bin/env bash
set -e

# Invoke contract functions
# Usage: ./scripts/invoke.sh <function> [args...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

# Default values
NETWORK="${NETWORK:-testnet}"
CONTRACT_ID="${CONTRACT_ID}"

if [ $# -eq 0 ]; then
    echo "Usage: ./scripts/invoke.sh <function> [args...]"
    echo ""
    echo "Available functions for aid_escrow:"
    echo "  initialize <admin>"
    echo "  create_package <recipient> <amount> <token>"
    echo "  claim_package <package_id>"
    echo "  get_package <package_id>"
    echo "  get_admin"
    echo ""
    echo "Example:"
    echo "  ./scripts/invoke.sh initialize GBADMIN..."
    echo "  ./scripts/invoke.sh create_package GBRECIPIENT 1000 USD..."
    exit 1
fi

FUNCTION="$1"
shift
ARGS="$@"

# Check for contract ID
if [ -z "$CONTRACT_ID" ]; then
    echo "❌ CONTRACT_ID not set. Deploy a contract first or set in .env"
    exit 1
fi

# Check for secret key
if [ -z "$SECRET_KEY" ]; then
    echo "❌ SECRET_KEY not set in .env"
    exit 1
fi

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
    *)
        echo "❌ Invalid network: $NETWORK"
        exit 1
        ;;
esac

echo "🔧 Invoking $FUNCTION on contract $CONTRACT_ID"
echo "🌐 Network: $NETWORK"
echo "📡 RPC: $RPC_URL"

# Build invoke command
INVOKE_CMD="soroban contract invoke \
    --id $CONTRACT_ID \
    --source $SECRET_KEY \
    --network $NETWORK \
    --rpc-url $RPC_URL \
    -- \
    $FUNCTION"

# Add arguments if provided
if [ -n "$ARGS" ]; then
    INVOKE_CMD="$INVOKE_CMD $ARGS"
fi

echo ""
echo "💻 Command:"
echo "$INVOKE_CMD"
echo ""

# Execute
eval "$INVOKE_CMD"