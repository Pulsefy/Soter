#!/usr/bin/env bash
set -euo pipefail

# Reproducible testnet deploy for aid_escrow:
# 1) build WASM  2) deploy  3) register in deployments/registry.json  4) print version tag
#
# Usage: ./scripts/deploy-testnet.sh [--tag-git]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TAG_GIT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --tag-git)
            TAG_GIT=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

cd "$PROJECT_DIR"

echo "🔨 Building aid_escrow WASM..."
if command -v stellar >/dev/null 2>&1; then
    stellar contract build
else
    cargo build --release --target wasm32v1-none -p aid_escrow
fi

echo "🚀 Deploying to testnet..."
./scripts/deploy.sh --network testnet --contract aid_escrow

if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "❌ Missing .env after deploy" >&2
    exit 1
fi

# shellcheck disable=SC1091
source "$PROJECT_DIR/.env"

if [ -z "${CONTRACT_ID:-}" ] || [ -z "${CONTRACT_VERSION:-}" ]; then
    echo "❌ CONTRACT_ID or CONTRACT_VERSION missing from .env" >&2
    exit 1
fi

WASM_FILE="target/wasm32v1-none/release/aid_escrow.wasm"
if [ ! -f "$WASM_FILE" ]; then
    WASM_FILE="target/wasm32-unknown-unknown/release/aid_escrow.wasm"
fi

REGISTER_OUT=$(python3 "$SCRIPT_DIR/register-deployment.py" \
    --project-dir "$PROJECT_DIR" \
    --contract-name aid_escrow \
    --contract-id "$CONTRACT_ID" \
    --version "$CONTRACT_VERSION" \
    --network testnet \
    --wasm "$WASM_FILE" \
    --deployer "${PUBLIC_KEY:-}")

echo "$REGISTER_OUT"

VERSION_TAG=$(echo "$REGISTER_OUT" | awk -F= '/^VERSION_TAG=/{print $2}')
echo ""
echo "✅ Registered deployment in deployments/registry.json"
echo "🏷️  Suggested git tag: $VERSION_TAG"
echo "   git tag -a '$VERSION_TAG' -m 'aid_escrow $CONTRACT_VERSION testnet deploy ($CONTRACT_ID)'"

if [ "$TAG_GIT" = true ]; then
    git tag -a "$VERSION_TAG" -m "aid_escrow $CONTRACT_VERSION testnet deploy ($CONTRACT_ID)"
    echo "🏷️  Created local git tag $VERSION_TAG"
fi

echo ""
echo "Next: ./scripts/initialize.sh --contract \"$CONTRACT_ID\" --admin \"\$PUBLIC_KEY\" --network testnet"
