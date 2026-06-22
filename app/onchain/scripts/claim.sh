#!/usr/bin/env bash
set -e

# Claim an aid package
# Usage: ./scripts/claim.sh --contract <ID> --id <PKG_ID>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

NETWORK="${NETWORK:-testnet}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --contract) CONTRACT_ID="$2"; shift 2 ;;
        --id)       PKG_ID="$2";      shift 2 ;;
        --network)  NETWORK="$2";     shift 2 ;;
        *) echo "❌ Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$CONTRACT_ID" ]; then echo "❌ --contract is required"; exit 1; fi
if [ -z "$PKG_ID" ];      then echo "❌ --id is required";       exit 1; fi
if [ -z "$SECRET_KEY" ];  then echo "❌ SECRET_KEY not set in .env"; exit 1; fi

case "$NETWORK" in
    testnet)    RPC_URL="${TESTNET_RPC_URL:-https://soroban-testnet.stellar.org:443}" ;;
    futurenet)  RPC_URL="${FUTURENET_RPC_URL:-https://rpc-futurenet.stellar.org:443}" ;;
    standalone) RPC_URL="${STANDALONE_RPC_URL:-http://localhost:8000/soroban/rpc}" ;;
    *) echo "❌ Invalid network: $NETWORK"; exit 1 ;;
esac

echo "======================================"
echo "  🎁 Invoking: claim"
echo "======================================"
echo "  Contract ID : $CONTRACT_ID"
echo "  Package ID  : $PKG_ID"
echo "  Network     : $NETWORK"
echo "======================================"

TX_OUTPUT=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$SECRET_KEY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    -- claim \
    --id "$PKG_ID" \
    2>&1)

echo ""
echo "✅ Transaction Output:"
echo "$TX_OUTPUT"

TX_HASH=$(echo "$TX_OUTPUT" | grep -o '"hash":"[^"]*"' | cut -d'"' -f4 || true)
if [ -n "$TX_HASH" ]; then
    echo ""
    echo "📋 TX Hash: $TX_HASH"
fi