#!/usr/bin/env bash
set -e

# View/query contract state (read-only)
# Usage: ./scripts/query.sh --contract <ID> --action <get_package|view_status|get_aggregates> [--id <PKG_ID>] [--token <ADDR>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

NETWORK="${NETWORK:-testnet}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --contract) CONTRACT_ID="$2"; shift 2 ;;
        --action)   ACTION="$2";      shift 2 ;;
        --id)       PKG_ID="$2";      shift 2 ;;
        --token)    TOKEN="$2";       shift 2 ;;
        --network)  NETWORK="$2";     shift 2 ;;
        *) echo "❌ Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$CONTRACT_ID" ]; then echo "❌ --contract is required"; exit 1; fi
if [ -z "$ACTION" ]; then
    echo "❌ --action is required. Options: get_package | view_status | get_aggregates"
    exit 1
fi
if [ -z "$SECRET_KEY" ]; then echo "❌ SECRET_KEY not set in .env"; exit 1; fi

case "$NETWORK" in
    testnet)    RPC_URL="${TESTNET_RPC_URL:-https://soroban-testnet.stellar.org:443}" ;;
    futurenet)  RPC_URL="${FUTURENET_RPC_URL:-https://rpc-futurenet.stellar.org:443}" ;;
    standalone) RPC_URL="${STANDALONE_RPC_URL:-http://localhost:8000/soroban/rpc}" ;;
    *) echo "❌ Invalid network: $NETWORK"; exit 1 ;;
esac

echo "======================================"
echo "  🔍 Querying: $ACTION"
echo "======================================"
echo "  Contract ID : $CONTRACT_ID"
echo "  Network     : $NETWORK"

BASE_CMD="soroban contract invoke \
    --id $CONTRACT_ID \
    --source $SECRET_KEY \
    --network $NETWORK \
    --rpc-url $RPC_URL"

case "$ACTION" in
    get_package)
        if [ -z "$PKG_ID" ]; then echo "❌ --id is required for get_package"; exit 1; fi
        echo "  Package ID  : $PKG_ID"
        echo "======================================"
        eval "$BASE_CMD -- get_package --id $PKG_ID"
        ;;
    view_status)
        if [ -z "$PKG_ID" ]; then echo "❌ --id is required for view_status"; exit 1; fi
        echo "  Package ID  : $PKG_ID"
        echo "======================================"
        eval "$BASE_CMD -- view_package_status --id $PKG_ID"
        ;;
    get_aggregates)
        if [ -z "$TOKEN" ]; then echo "❌ --token is required for get_aggregates"; exit 1; fi
        echo "  Token       : $TOKEN"
        echo "======================================"
        eval "$BASE_CMD -- get_aggregates --token $TOKEN"
        ;;
    *)
        echo "❌ Unknown action: $ACTION"
        echo "   Options: get_package | view_status | get_aggregates"
        exit 1
        ;;
esac