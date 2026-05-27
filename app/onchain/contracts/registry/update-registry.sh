#!/usr/bin/env bash
# =============================================================================
# update-registry.sh
# Populates contracts/registry/testnet.registry.json with live values after
# a Soroban contract deployment on Stellar Testnet.
#
# Usage:
#   ./contracts/registry/update-registry.sh \
#     --contract-id  <STELLAR_CONTRACT_ID>  \
#     --deployer     <DEPLOYER_PUBLIC_KEY>   \
#     --wasm-hash    <WASM_HASH>             \
#     --admin        <ADMIN_PUBLIC_KEY>
#
# Requirements: jq, git
# =============================================================================

set -euo pipefail

REGISTRY_FILE="$(cd "$(dirname "$0")" && pwd)/testnet.registry.json"
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/testnet.env"

# ---------- parse args -------------------------------------------------------
CONTRACT_ID=""
DEPLOYER=""
WASM_HASH=""
ADMIN=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --contract-id) CONTRACT_ID="$2"; shift 2 ;;
    --deployer)    DEPLOYER="$2";    shift 2 ;;
    --wasm-hash)   WASM_HASH="$2";   shift 2 ;;
    --admin)       ADMIN="$2";       shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$CONTRACT_ID" || -z "$DEPLOYER" || -z "$WASM_HASH" || -z "$ADMIN" ]]; then
  echo "Error: --contract-id, --deployer, --wasm-hash, and --admin are all required."
  exit 1
fi

# ---------- capture context --------------------------------------------------
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "Updating registry..."
echo "  contract_id : $CONTRACT_ID"
echo "  deployer    : $DEPLOYER"
echo "  wasm_hash   : $WASM_HASH"
echo "  admin       : $ADMIN"
echo "  git_sha     : $GIT_SHA"
echo "  timestamp   : $TIMESTAMP"

# ---------- patch JSON -------------------------------------------------------
jq \
  --arg contract_id  "$CONTRACT_ID" \
  --arg deployer     "$DEPLOYER" \
  --arg wasm_hash    "$WASM_HASH" \
  --arg admin        "$ADMIN" \
  --arg git_sha      "$GIT_SHA" \
  --arg timestamp    "$TIMESTAMP" \
  '
  ._meta.last_updated                             = $timestamp |
  ._meta.deployed_at_commit                       = $git_sha |
  .contracts.aid_escrow.contract_id               = $contract_id |
  .contracts.aid_escrow.deployer_address          = $deployer |
  .contracts.aid_escrow.wasm_hash                 = $wasm_hash |
  .contracts.aid_escrow.deployed_at               = $timestamp |
  .contracts.aid_escrow.deployed_at_commit        = $git_sha |
  .contracts.aid_escrow.init_args.admin           = $admin
  ' \
  "$REGISTRY_FILE" > "${REGISTRY_FILE}.tmp" && mv "${REGISTRY_FILE}.tmp" "$REGISTRY_FILE"

# ---------- sync env file ----------------------------------------------------
sed -i \
  -e "s|REPLACE_WITH_CONTRACT_ID|$CONTRACT_ID|g" \
  -e "s|REPLACE_WITH_DEPLOYER_PUBLIC_KEY|$DEPLOYER|g" \
  -e "s|REPLACE_WITH_WASM_HASH|$WASM_HASH|g" \
  -e "s|REPLACE_WITH_ISO_TIMESTAMP|$TIMESTAMP|g" \
  -e "s|REPLACE_WITH_GIT_SHA|$GIT_SHA|g" \
  -e "s|REPLACE_WITH_ADMIN_PUBLIC_KEY|$ADMIN|g" \
  "$ENV_FILE"

echo ""
echo "Registry updated successfully:"
echo "  $REGISTRY_FILE"
echo "  $ENV_FILE"