Merkle Allowlist Test Tool

Usage

1. Install dependencies:

```bash
cd tools/merkle-allowlist
npm ci
```

2. Run locally (no on-chain calls):

```bash
node index.js
```

3. To verify on-chain, set env vars:

```bash
export TESTNET_RPC_URL="https://..."
export MERKLE_CONTRACT_ADDRESS="0x..."
export MERKLE_CONTRACT_ABI_PATH="/path/to/abi.json"
node index.js
```

Stable error outputs: the tool emits JSON lines with a `result` object containing either `success: true` or `error: { code, message }`. Use these codes to map backend errors.
