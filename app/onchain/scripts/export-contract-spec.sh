#!/usr/bin/env bash
set -euo pipefail

# Export the aid_escrow contract interface (SCSpecEntry XDR stream, base64) to a
# checked-in artifact that the backend generates TypeScript types from.
#
# The artifact is the shared source of truth between the contract and the
# backend: `app/backend` never reads the WASM directly, only this file.
#
# Usage:
#   ./scripts/export-contract-spec.sh [--wasm <path>] [--output <path>] [--build] [--check]
#
#   --wasm <path>    WASM to read the spec from.
#                    Default: target/wasm32v1-none/release/aid_escrow.wasm
#   --output <path>  Artifact to write.
#                    Default: contracts/aid_escrow/interface.xdr
#   --build          Build the WASM first (cargo build --release --target wasm32v1-none).
#   --check          CI mode: fail when the committed artifact is out of date.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

WASM_FILE="target/wasm32v1-none/release/aid_escrow.wasm"
OUTPUT_FILE="contracts/aid_escrow/interface.xdr"
BUILD=false
CHECK=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --wasm)
            WASM_FILE="$2"
            shift 2
            ;;
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --build)
            BUILD=true
            shift
            ;;
        --check)
            CHECK=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

cd "$PROJECT_DIR"

if ! command -v stellar >/dev/null 2>&1; then
    echo "❌ Stellar CLI not found. Install it with: cargo install --locked stellar-cli" >&2
    exit 1
fi

if [ "$BUILD" = true ]; then
    echo "🔨 Building aid_escrow WASM (wasm32v1-none)..."
    cargo build --release --target wasm32v1-none -p aid_escrow
fi

if [ ! -f "$WASM_FILE" ]; then
    echo "❌ WASM not found: $WASM_FILE" >&2
    echo "   Build it first: ./scripts/export-contract-spec.sh --build" >&2
    exit 1
fi

TEMP_FILE="$(mktemp)"
trap 'rm -f "$TEMP_FILE"' EXIT

echo "📤 Reading contract spec from $WASM_FILE..."
stellar contract info interface --wasm "$WASM_FILE" --output xdr-base64 2>/dev/null \
    | tr -d '[:space:]' > "$TEMP_FILE"

if [ ! -s "$TEMP_FILE" ]; then
    echo "❌ Stellar CLI returned an empty contract spec" >&2
    exit 1
fi

# Normalize to base64 + trailing newline so the artifact is diff-friendly.
printf '%s\n' "$(cat "$TEMP_FILE")" > "$TEMP_FILE"

if [ "$CHECK" = true ]; then
    if [ ! -f "$OUTPUT_FILE" ]; then
        echo "❌ Committed contract spec artifact not found: $OUTPUT_FILE" >&2
        echo "   Run: ./scripts/export-contract-spec.sh --build" >&2
        exit 1
    fi

    if diff -q "$OUTPUT_FILE" "$TEMP_FILE" >/dev/null; then
        echo "✅ Contract spec artifact is up to date — no drift detected."
        exit 0
    fi

    echo "❌ Contract spec drift detected!" >&2
    echo "" >&2
    echo "   $OUTPUT_FILE does not match the spec embedded in $WASM_FILE." >&2
    echo "   The contract interface changed without the artifact being re-exported." >&2
    echo "" >&2
    echo "   To fix this, run:" >&2
    echo "     ./scripts/export-contract-spec.sh --build" >&2
    echo "   then commit the updated $OUTPUT_FILE." >&2
    echo "" >&2
    echo "   Contract spec entries changed:" >&2
    diff <(fold -w 76 "$OUTPUT_FILE") <(fold -w 76 "$TEMP_FILE") | head -40 >&2 || true
    exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"
cp "$TEMP_FILE" "$OUTPUT_FILE"
chmod 644 "$OUTPUT_FILE"

echo "✅ Wrote contract spec to $OUTPUT_FILE ($(wc -c < "$OUTPUT_FILE" | tr -d ' ') bytes)"
echo ""
echo "Next: pnpm --filter backend run contract:generate"
