# Soroban Testnet Deployment Runbook

This runbook documents a repeatable procedure for building, deploying, initializing, and verifying the `aid_escrow` Soroban contract on Stellar Testnet.

## Recorded Deployments

Each successful deployment produces a canonical record under `deployments/`.

| Date       | Network | Contract ID                                                  | Record |
| :--------- | :------ | :----------------------------------------------------------- | :----- |
| 2026-06-03 | Testnet | `CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG`  | [deployments/testnet-2026-06-03.md](deployments/testnet-2026-06-03.md) |

## 1. Purpose

Use this runbook to deploy the contract consistently, verify success, and perform a minimal post-deploy health check.

## 2. Prerequisites

- Linux / macOS shell environment
- Rust toolchain installed
- `wasm32-unknown-unknown` target installed
- `soroban-cli` installed
- A funded Testnet account secret key

### Install required tools

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none
cargo install --locked stellar-cli
```

> **Note:** Stellar CLI 26+ uses the `wasm32v1-none` target (replaces the older `wasm32-unknown-unknown` target). The build output lands in `target/wasm32v1-none/release/`.

## 3. Environment setup

From `app/onchain` create a `.env` file using `.env.example` as a template.

```bash
cd /workspaces/Soter/app/onchain
cp .env.example .env
```

Edit `.env` and set the following values:

```bash
NETWORK=testnet
SECRET_KEY=SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PUBLIC_KEY=GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
CONTRACT_NAME=aid_escrow
TESTNET_RPC_URL=https://soroban-testnet.stellar.org:443
```

> If you use a different RPC endpoint, set `TESTNET_RPC_URL` accordingly.

## 4. Build steps

Build the contract to WebAssembly from the `app/onchain` directory.

Using the Stellar CLI (recommended — handles target and optimizer automatically):

```bash
cd /workspaces/Soter/app/onchain
stellar contract build
```

Or directly with cargo (Stellar CLI 26+, `wasm32v1-none` target):

```bash
cargo build --release --target wasm32v1-none -p aid_escrow
```

Confirm the build output exists:

```bash
ls target/wasm32v1-none/release/aid_escrow.wasm
```

Expected output:

- `target/wasm32v1-none/release/aid_escrow.wasm`

## 5. Deploy steps

Use the existing deploy script to publish the contract to Testnet.

```bash
cd /workspaces/Soter/app/onchain
./scripts/deploy.sh --network testnet
```

If the deploy succeeds, note the returned contract ID.

Example expected output:

```text
✅ Deployment successful!
📋 Contract ID: ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890
```

If the script updates `.env`, it will also write `CONTRACT_ID=<id>` there.

### Manual deploy alternative

If you want to deploy directly without the wrapper script (Stellar CLI 26+):

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/aid_escrow.wasm \
  --source "$SECRET_KEY" \
  --network testnet
```

After a successful deploy, copy the printed Contract ID and record it as a new entry in `deployments/` following the format of [deployments/testnet-2026-06-03.md](deployments/testnet-2026-06-03.md).

## 6. Initialization steps

After deploy, initialize the contract by setting the admin address.

```bash
cd /workspaces/Soter/app/onchain
./scripts/initialize.sh --contract "$CONTRACT_ID" --admin "$PUBLIC_KEY" --network testnet
```

Expected output should include a transaction result and a transaction hash.

## 7. Verification steps

### 7.1 Check admin

Verify the contract was initialized and the admin is set:

```bash
cd /workspaces/Soter/app/onchain
./scripts/testnet-invoke.sh get-admin --contract-id "$CONTRACT_ID" --source "$SECRET_KEY"
```

Expected output:

- the admin public key should match the value passed to `--admin`
- a transaction hash should be shown

### 7.2 Verify contract state with a query

The existing helper script can be used to verify view methods and contract state. The easiest read-only verification is the admin query via `get-admin`.

```bash
./scripts/testnet-invoke.sh get-admin --contract-id "$CONTRACT_ID" --source "$SECRET_KEY"
```

If you want a package-specific query later, use `./scripts/query.sh` with one of the supported actions:

```bash
./scripts/query.sh --contract "$CONTRACT_ID" --action get_package --id 1 --network testnet
```

### 7.3 Optional package sanity check

Use the helper script to create and query a package if you want a functional end-to-end test:

```bash
./scripts/testnet-invoke.sh create-package \
  --operator "$PUBLIC_KEY" \
  --id 1 \
  --recipient "GRECIPIENT..." \
  --amount 10000000 \
  --token "CTOKEN..."

./scripts/testnet-invoke.sh get-package --id 1 --contract-id "$CONTRACT_ID"
```

## 8. Minimal post-deploy health check

Run these checks immediately after initialization:

1. Confirm contract ID is present in `.env` or from deploy output.
2. Confirm RPC endpoint responds:

```bash
curl -I "$TESTNET_RPC_URL"
```

3. Confirm `get-admin` returns the expected admin:

```bash
./scripts/testnet-invoke.sh get-admin --contract-id "$CONTRACT_ID" --source "$SECRET_KEY"
```

Expected responses:

- HTTP 200 / reachable RPC endpoint
- `Transaction hash:` present in command output
- returned admin address equals the expected admin public key

## 9. Troubleshooting common Soroban RPC issues

### 9.1 RPC endpoint unreachable or timeout

Symptoms:
- `connection refused`
- `Failed to connect`
- `timeout`

Actions:
- Verify the RPC URL is correct.
- Check network connectivity.
- Try a different public RPC endpoint.
- Confirm the endpoint is not blocked by local firewall or proxy.

Example:

```bash
curl -v "$TESTNET_RPC_URL"
```

### 9.2 `soroban` CLI returns `error: invalid request` or `method not found`

Cause:
- wrong RPC path
- misconfigured endpoint

Fix:
- Use `https://soroban-testnet.stellar.org:443` for public Testnet.
- For standalone local RPC use `http://localhost:8000/soroban/rpc`.

### 9.3 RPC returns stale or failed ledger data

Symptoms:
- `timeout waiting for ledger` or ledger sync errors
- unexpected `transaction failed` responses

Fix:
- Retry the request after a short delay.
- Confirm the endpoint is healthy from the provider.
- If using a local node, ensure it is fully synced.

### 9.4 Transaction fails unexpectedly after deploy

Symptoms:
- `contract deploy` returns error or no contract ID
- `soroban contract invoke` returns failure

Common causes:
- deployer account is not funded with enough Testnet XLM
- wrong `SECRET_KEY` or malformed key
- contract artifact not built or wrong WASM path
- contract ID missing or incorrectly passed

Fix:
- Fund the account with Testnet friendbot if needed.
- Confirm `SECRET_KEY` is valid and corresponds to a funded account.
- Rebuild the contract and verify `target/wasm32v1-none/release/aid_escrow.wasm` exists.
- Re-run deploy with `stellar contract deploy --wasm target/wasm32v1-none/release/aid_escrow.wasm --source "$SECRET_KEY" --network testnet`.

### 9.5 Public RPC rate limiting or service disruption

Symptoms:
- `HTTP 429`
- `service unavailable`
- intermittent acknowledgements

Fix:
- Wait a few minutes and retry.
- Use a dedicated or alternative RPC endpoint if available.
- If the public endpoint is down, switch to a different provider or local Soroban node.

### 9.6 `Contract ID` not extracted or `.env` not updated

Symptoms:
- contract deploy prints the ID but script does not save it
- `.env` still missing `CONTRACT_ID`

Fix:
- Copy the contract ID from deploy output manually.
- Add `CONTRACT_ID=<id>` to `.env`.
- Re-run initialization with the saved ID.

## 10. Notes

- The `app/onchain/scripts/deploy.sh` wrapper uses `SECRET_KEY` or `DEPLOYER_SECRET_KEY` from `.env`.
- The contract is built from the `aid_escrow` crate.
- Always keep secret keys out of source control.

---

If the public Soroban Testnet RPC is failing repeatedly, use a secondary provider or local standalone node for consistent deployment.

## 11. Handling Testnet Contract Upgrades & State Migration

When iterating on the `aid_escrow` contract on Testnet, changes fall into two categories: non-breaking and breaking.

### Non-Breaking Changes
*Examples: Adding a new read-only function, fixing a bug that doesn't change storage formats.*
1. **Redeploy**: Soroban doesn't support true in-place upgrades of Wasm code for the same Contract ID yet. You must deploy a **new Contract ID**.
2. **Version Bump**: Ensure you bump the semantic `version` in `Cargo.toml`.
3. **No Migration Needed**: Since it's a new instance, old state is lost. If this is purely a logic update and you don't care about old testnet packages, just use the new Contract ID.

### Breaking Changes (State/Storage Layout)
*Examples: Changing the `Package` struct fields, changing `DataKey` symbols.*
1. **Redeploy**: Deploy the new Wasm, which generates a new Contract ID.
2. **State Migration Strategy**: 
   - **Reset**: Since it's Testnet, the preferred approach is often to reset the environment (wipe the database, deploy a fresh contract).
   - **Migrate**: If state must be preserved, you must write an off-chain script to read packages from the old contract and re-create them in the new contract using the admin or a dedicated migration function.

**Note on Queryable Versions:** 
The contract semantic version is queryable on-chain via the `contract_version()` function. Additionally, `deploy.sh` automatically parses the `Cargo.toml` version and exports it as `CONTRACT_VERSION` in your `.env` artifact.

## 12. Redeployment Checklist (Preventing Orphaned Integrations)

When a new contract is deployed, its **Contract ID changes**. If downstream components are not updated, they will interact with the orphaned contract, causing out-of-sync state or failures.

**Whenever you run `./scripts/deploy.sh` and get a new Contract ID, complete this checklist:**

- [ ] **1. Backend Update:** 
  - Update `CONTRACT_ID` and `CONTRACT_VERSION` in `app/backend/.env`.
  - Restart the backend server (`pnpm --filter backend start:dev` or trigger a production redeploy).
- [ ] **2. Database Sync:** 
  - If the upgrade involved breaking storage changes, truncate the local/testnet database tables related to packages to avoid mismatched on-chain vs. off-chain state.
- [ ] **3. Frontend Update:** 
  - Ensure the frontend receives the new `CONTRACT_ID` (usually fetched via a config endpoint from the backend).
  - Clear local storage or cached states if they reference old package IDs.
- [ ] **4. Mobile App Update:** 
  - Ensure the React Native app restarts or fetches the updated config from the backend.
- [ ] **5. Indexer / Event Listeners:** 
  - If you run an off-chain indexer, point it to the new `CONTRACT_ID` and restart it so it begins streaming events from the new deployment ledger.
- [ ] **6. Announce Change:** 
  - Notify the team in Discord/Slack that Testnet has migrated to `<NEW_CONTRACT_ID>` (v`<VERSION>`) so other developers pull the latest `.env` config.
