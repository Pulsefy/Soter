#!/usr/bin/env bash
set -euo pipefail

# Repeatable Testnet invoke helper for common aid_escrow actions.
# Usage: ./scripts/testnet-invoke.sh <action> [options]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/.env"
fi

NETWORK="testnet"
RPC_URL="${TESTNET_RPC_URL:-https://soroban-testnet.stellar.org:443}"
CONTRACT_ID="${CONTRACT_ID:-}"
SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-${SECRET_KEY:-${DEPLOYER_SECRET_KEY:-}}}"

usage() {
    cat <<'USAGE'
Usage:
  ./scripts/testnet-invoke.sh <action> [options]

Common options:
  --contract-id <id>     Contract ID to invoke. Defaults to CONTRACT_ID.
  --source <account>     Soroban source account or secret. Defaults to SOURCE_ACCOUNT,
                         SECRET_KEY, or DEPLOYER_SECRET_KEY.
  --rpc-url <url>        Testnet RPC URL. Defaults to TESTNET_RPC_URL or public RPC.

Actions:
  initialize --admin <address>
  create-package --operator <address> --id <u64> --recipient <address> \
    --amount <i128> --token <address> [--expires-at <u64>] [--metadata <map>]
  claim --id <u64>
  get-package --id <u64>
  view-status --id <u64>
  get-admin
  get-aggregates --token <address>

Examples:
  ./scripts/testnet-invoke.sh initialize --admin GADMIN...
  ./scripts/testnet-invoke.sh create-package --operator GADMIN... --id 1 \
    --recipient GRECIPIENT... --amount 10000000 --token CTOKEN...
  ./scripts/testnet-invoke.sh claim --id 1
  ./scripts/testnet-invoke.sh get-package --id 1
  ./scripts/testnet-invoke.sh view-status --id 1
USAGE
}

die() {
    echo "error: $*" >&2
    exit 1
}

require_value() {
    local name="$1"
    local value="${2:-}"
    if [ -z "$value" ]; then
        die "$name is required"
    fi
}

set_common_option() {
    case "$1" in
        --contract-id)
            CONTRACT_ID="$2"
            return 0
            ;;
        --source)
            SOURCE_ACCOUNT="$2"
            return 0
            ;;
        --rpc-url)
            RPC_URL="$2"
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

redact_source() {
    if [ -z "$SOURCE_ACCOUNT" ]; then
        echo "<unset>"
    elif [ "${#SOURCE_ACCOUNT}" -le 12 ]; then
        echo "<redacted>"
    else
        echo "${SOURCE_ACCOUNT:0:6}...${SOURCE_ACCOUNT: -4}"
    fi
}

print_args() {
    echo "Action arguments:"
    while [ "$#" -gt 0 ]; do
        printf '  %s\n' "$1"
        shift
    done
}

extract_tx_hash() {
    grep -Eio '(tx|transaction)[ _-]?hash[^[:alnum:]]*[[:alnum:]]{20,}|[A-Fa-f0-9]{64}' \
        | head -n 1 \
        | sed -E 's/.*[^A-Fa-f0-9]([A-Fa-f0-9]{64}).*/\1/'
}

run_contract() {
    local function_name="$1"
    shift

    require_value "CONTRACT_ID" "$CONTRACT_ID"
    require_value "source account" "$SOURCE_ACCOUNT"

    local -a cmd=(
        soroban contract invoke
        --id "$CONTRACT_ID"
        --source "$SOURCE_ACCOUNT"
        --network "$NETWORK"
        --rpc-url "$RPC_URL"
        --
        "$function_name"
        "$@"
    )

    local -a display_cmd=(
        soroban contract invoke
        --id "$CONTRACT_ID"
        --source "$(redact_source)"
        --network "$NETWORK"
        --rpc-url "$RPC_URL"
        --
        "$function_name"
        "$@"
    )

    echo "Network: $NETWORK"
    echo "RPC URL: $RPC_URL"
    echo "Contract ID: $CONTRACT_ID"
    echo "Source: $(redact_source)"
    echo "Function: $function_name"
    print_args "$@"
    echo
    echo "Command:"
    printf '  %q' "${display_cmd[@]}"
    echo
    echo

    local output
    if ! output="$("${cmd[@]}" 2>&1)"; then
        echo "$output"
        exit 1
    fi

    echo "$output"
    echo

    local tx_hash
    tx_hash="$(printf '%s\n' "$output" | extract_tx_hash || true)"
    if [ -n "$tx_hash" ]; then
        echo "Transaction hash: $tx_hash"
    else
        echo "Transaction hash: not found in Soroban CLI output"
    fi
}

parse_common_or_die() {
    local option="$1"
    local value="${2:-}"
    case "$option" in
        --contract-id|--source|--rpc-url)
            require_value "$option" "$value"
            set_common_option "$option" "$value"
            ;;
        *)
            die "unknown option: $option"
            ;;
    esac
}

ACTION="${1:-}"
if [ -z "$ACTION" ] || [ "$ACTION" = "-h" ] || [ "$ACTION" = "--help" ]; then
    usage
    exit 0
fi
shift

case "$ACTION" in
    initialize)
        admin=""
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --admin)
                    admin="${2:-}"
                    shift 2
                    ;;
                --contract-id|--source|--rpc-url)
                    parse_common_or_die "$1" "${2:-}"
                    shift 2
                    ;;
                *)
                    die "unknown option for initialize: $1"
                    ;;
            esac
        done
        require_value "--admin" "$admin"
        run_contract init --admin "$admin"
        ;;

    create-package)
        operator=""
        package_id=""
        recipient=""
        amount=""
        token=""
        expires_at="0"
        metadata="{}"
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --operator)
                    operator="${2:-}"
                    shift 2
                    ;;
                --id)
                    package_id="${2:-}"
                    shift 2
                    ;;
                --recipient)
                    recipient="${2:-}"
                    shift 2
                    ;;
                --amount)
                    amount="${2:-}"
                    shift 2
                    ;;
                --token)
                    token="${2:-}"
                    shift 2
                    ;;
                --expires-at)
                    expires_at="${2:-}"
                    shift 2
                    ;;
                --metadata)
                    metadata="${2:-}"
                    shift 2
                    ;;
                --contract-id|--source|--rpc-url)
                    parse_common_or_die "$1" "${2:-}"
                    shift 2
                    ;;
                *)
                    die "unknown option for create-package: $1"
                    ;;
            esac
        done
        require_value "--operator" "$operator"
        require_value "--id" "$package_id"
        require_value "--recipient" "$recipient"
        require_value "--amount" "$amount"
        require_value "--token" "$token"
        run_contract create_package \
            --operator "$operator" \
            --id "$package_id" \
            --recipient "$recipient" \
            --amount "$amount" \
            --token "$token" \
            --expires_at "$expires_at" \
            --metadata "$metadata"
        ;;

    claim)
        package_id=""
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --id)
                    package_id="${2:-}"
                    shift 2
                    ;;
                --contract-id|--source|--rpc-url)
                    parse_common_or_die "$1" "${2:-}"
                    shift 2
                    ;;
                *)
                    die "unknown option for claim: $1"
                    ;;
            esac
        done
        require_value "--id" "$package_id"
        run_contract claim --id "$package_id"
        ;;

    get-package|view-status)
        package_id=""
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --id)
                    package_id="${2:-}"
                    shift 2
                    ;;
                --contract-id|--source|--rpc-url)
                    parse_common_or_die "$1" "${2:-}"
                    shift 2
                    ;;
                *)
                    die "unknown option for $ACTION: $1"
                    ;;
            esac
        done
        require_value "--id" "$package_id"
        if [ "$ACTION" = "get-package" ]; then
            run_contract get_package --id "$package_id"
        else
            run_contract view_package_status --id "$package_id"
        fi
        ;;

    get-admin)
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --contract-id|--source|--rpc-url)
                    parse_common_or_die "$1" "${2:-}"
                    shift 2
                    ;;
                *)
                    die "unknown option for get-admin: $1"
                    ;;
            esac
        done
        run_contract get_admin
        ;;

    get-aggregates)
        token=""
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --token)
                    token="${2:-}"
                    shift 2
                    ;;
                --contract-id|--source|--rpc-url)
                    parse_common_or_die "$1" "${2:-}"
                    shift 2
                    ;;
                *)
                    die "unknown option for get-aggregates: $1"
                    ;;
            esac
        done
        require_value "--token" "$token"
        run_contract get_aggregates --token "$token"
        ;;

    *)
        die "unknown action: $ACTION"
        ;;
esac
