# AidEscrow Contract — Testnet Deployment Runbook

This runbook covers every step to build, deploy, initialize, and verify the `aid_escrow` Soroban contract on Stellar Testnet from a clean environment.

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Rust | 1.78+ | `curl https://sh.rustup.rs -sSf \| sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | 21+ | `cargo install --locked soroban-cli` |
| Stellar account with testnet XLM | — | [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=test) |

Verify tools are ready:

```bash
rustc --version          # rustc 1.78.x or newer
soroban --version        # soroban 21.x or newer
soroban network ls       # should list testnet
```

---

## 1. Environment Setup

```bash
cd app/onchain
cp .env.example .env
```

Edit `.env` and fill in the required values:

```bash
NETWORK=testnet
SECRET_KEY=SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  # your deployer secret
```

All other values have working defaults. Never commit `.env`.

Fund your deployer account if it has no testnet XLM:

```bash
# Derive the public key from your secret
soroban keys address "$SECRET_KEY"

# Fund via Friendbot (replace with your public key)
curl "https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>"
```

---

## 2. Build

```bash
cd app/onchain
make build
```

This runs `./scripts/build.sh --optimize`, which compiles the contract with `--release` for the `wasm32-unknown-unknown` target and applies size optimizations defined in `Cargo.toml` (`opt-level = "z"`, `lto = true`).

Expected output:

```
🚀 Building contracts...
   Compiling aid_escrow v0.1.0
   Finished release [optimized] target(s)
```

Confirm the artifact exists:

```bash
ls -lh target/wasm32-unknown-unknown/release/aid_escrow.wasm
# Expected: file present, typically 50–200 KB
```

---

## 3. Run Tests (recommended before deploy)

```bash
make test
```

All tests must pass before deploying. A failing test suite is a hard stop.

---

## 4. Deploy

```bash
make deploy
# or explicitly:
./scripts/deploy.sh --network testnet
```

On success the script prints and saves the contract ID to `.env`:

```
✅ Deployment successful!
📋 Contract ID: CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
📝 Updated .env with contract ID
```

Export it for the remaining steps:

```bash
export CONTRACT_ID="CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

---

## 5. Initialize

The contract must be initialized exactly once. Calling `init` a second time will fail.

```bash
# Derive your admin public key
ADMIN=$(soroban keys address "$SECRET_KEY")

./scripts/initialize.sh \
  --contract "$CONTRACT_ID" \
  --admin    "$ADMIN" \
  --network  testnet
```

Or via the Makefile:

```bash
make initialize CONTRACT_ID="$CONTRACT_ID" ADMIN="$ADMIN"
```

Expected output:

```
====================================
  🔧 Invoking: init
====================================
  Contract ID : CXXX...
  Admin       : GXXX...
  Network     : testnet
  RPC         : https://soroban-testnet.stellar.org:443
====================================
✅ Transaction Output:
...
```

---

## 6. Post-Deploy Health Check

Run these read-only queries to confirm the contract is live and correctly initialized.

### 6a. Verify admin is set

```bash
./scripts/testnet-invoke.sh get-admin \
  --contract-id "$CONTRACT_ID"
```

Expected output:

```json
"GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

The returned address must match the `--admin` value used in step 5.

### 6b. Query aggregates (empty baseline)

```bash
# Use the native XLM token address on testnet
NATIVE_TOKEN="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

./scripts/query.sh \
  --contract "$CONTRACT_ID" \
  --action   get_aggregates \
  --token    "$NATIVE_TOKEN"
```

Expected output (freshly initialized contract):

```json
{
  "total_packages": 0,
  "active_packages": 0,
  "claimed_packages": 0,
  "cancelled_packages": 0,
  "total_funded": "0",
  "total_disbursed": "0"
}
```

### 6c. Smoke-test: create and query a package

```bash
OPERATOR="$ADMIN"
RECIPIENT="GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"  # any valid testnet address

./scripts/testnet-invoke.sh create-package \
  --contract-id "$CONTRACT_ID" \
  --operator    "$OPERATOR" \
  --id          1 \
  --recipient   "$RECIPIENT" \
  --amount      10000000 \
  --token       "$NATIVE_TOKEN"

# Then read it back
./scripts/query.sh \
  --contract "$CONTRACT_ID" \
  --action   get_package \
  --id       1
```

Expected output:

```json
{
  "id": 1,
  "operator": "GXXX...",
  "recipient": "GXXX...",
  "amount": "10000000",
  "token": "CDLZFC3...",
  "status": "Active",
  "expires_at": null
}
```

If all three checks pass, the contract is healthy.

---

## 7. Save Deployment Record

Record the following for your team:

```
Network:     testnet
Contract ID: CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Admin:       GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Deployed:    YYYY-MM-DD
Deployer:    <your public key>
```

Update `app/backend/.env` with `CONTRACT_ID` so the backend can interact with it.

---

## Troubleshooting

### `error: no such subcommand: contract`
Soroban CLI is not installed or not on `PATH`. Run `cargo install --locked soroban-cli` and ensure `~/.cargo/bin` is in `PATH`.

### `error: account not found` / `HostError: Error(Value, InvalidInput)`
The deployer account has no testnet XLM. Fund it via Friendbot (step 1).

### `error: Contract not built` (deploy.sh)
The WASM file is missing. Run `make build` first.

### `error: already initialized` on `init`
The contract was already initialized. This is expected if you are re-running the runbook against an existing deployment. Skip step 5.

### RPC timeout / `connection refused`
The Soroban testnet RPC is occasionally rate-limited or under maintenance.

- Wait 30–60 seconds and retry.
- Check status at [https://status.stellar.org](https://status.stellar.org).
- Switch to an alternative public RPC: `https://soroban-testnet.stellar.org` (default) or `https://rpc-testnet.stellar.org`.
- Override in `.env`: `TESTNET_RPC_URL=https://rpc-testnet.stellar.org`.

### `error: transaction simulation failed` / `HostError: Error(WasmVm, ...)`
The WASM is malformed or the wrong build profile was used.

1. Run `make clean && make build` to rebuild from scratch.
2. Confirm the WASM target: `file target/wasm32-unknown-unknown/release/aid_escrow.wasm` should report `WebAssembly`.

### `error: insufficient funds` on deploy
The deployer account needs at least ~10 XLM to cover the contract upload fee. Fund via Friendbot.

### `error: duplicate contract` / contract ID already exists
You are re-deploying the same WASM hash. This is fine — Soroban deduplicates WASM blobs but still returns a new contract ID. Use the new ID going forward.

### Soroban CLI version mismatch
If you see unexpected flag errors, check `soroban --version`. The scripts target CLI 21+. Upgrade with:

```bash
cargo install --locked soroban-cli --force
```
