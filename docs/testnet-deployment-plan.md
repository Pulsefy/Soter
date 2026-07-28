# Testnet Deployment Plan — aid_escrow

> Canonical plan used by deploy scripts, backend config, and CI workflows.
> Supersedes ad-hoc config; all components must align to this document.

## 1. Network Topology

| Parameter | Value |
|-----------|-------|
| Network name | `testnet` |
| RPC URL | `https://soroban-testnet.stellar.org:443` |
| Network passphrase | `Test SDF Network ; September 2015` |
| Native XLM SAC address | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Friendbot URL | `https://friendbot.stellar.org` |

All deploy scripts (`deploy.sh`, `deploy-testnet.sh`, `initialize.sh`) and backend (`soroban.adapter.ts`) MUST use these exact values unless overridden via `.env`.

## 2. Admin Address & Key Management

### 2.1 Key Separation

Three distinct keypairs are maintained for testnet:

| Role | Env variable | Used by | Purpose |
|------|-------------|---------|---------|
| **Deployer** | `SECRET_KEY` / `DEPLOYER_SECRET_KEY` | `deploy.sh`, `deploy-testnet.sh` | Uploads WASM, funds contract creation. Funded via Friendbot. |
| **Admin** | `SOROBAN_ADMIN_SECRET_KEY` | `initialize.sh`, backend (`soroban.adapter.ts`), CI smoke tests | Signed as `init(admin)` at deployment time. Performs admin operations (pause, config, disburse, add/remove distributors). |
| **Distributor(s)** | Per-distributor keypairs | `backend` (secondary signer config) | Create packages, extend expiry. Independent of admin key. |

### 2.2 Admin Key Generation

```bash
soroban keys generate --network testnet     # creates a local identity
soroban keys address <identity-name>         # prints G-prefixed public key
```

The public key is the `admin` argument passed to `init()` at contract initialization. This key is **immutable** for the lifetime of the contract — Soroban does not support rotating the admin address on a deployed contract.

### 2.3 Admin Key Storage

| Environment | Storage method | Location |
|-------------|---------------|----------|
| Local dev | `.env` file (gitignored) | `app/onchain/.env` |
| Backend server | `.env` file (gitignored) | `app/backend/.env` |
| CI/CD | GitHub Actions secrets | `SOROBAN_ADMIN_SECRET_KEY`, `SOROBAN_CONTRACT_ID` |
| Smoke tests | GitHub Actions secrets | `SOROBAN_ADMIN_SECRET_KEY`, `SOROBAN_RECIPIENT_SECRET_KEY` |

Never commit secret keys. The `.env.example` files document all required variables without secrets.

### 2.4 Admin Key Rotation

Since the admin address is **immutable** on a deployed contract, rotation requires:

1. **Deploy a new contract** with the new admin key (`make deploy; make initialize ADMIN=<new-key>`)
2. **Register** in `deployments/registry.json` (via `deploy-testnet.sh`)
3. **Point all downstream systems** to the new `CONTRACT_ID`
4. **Pause and archive** the old contract (optional, for cleanup)
5. **Update GitHub secrets** with the new key and contract ID

Rotation is triggered:
- Scheduled: every 90 days
- Emergency: suspected compromise (see [admin-key-policy-testnet.md](./admin-key-policy-testnet.md) section "Incident Response")

### 2.5 Current Testnet Deployment

See `deployments/registry.json` for the active deployment record. As of the latest deploy:

| Field | Value (from registry.json) |
|-------|---------------------------|
| Contract ID | `CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG` |
| Version | `0.1.0` (crate: `0.2.0` — see §4.2) |
| Deployer | `GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY` |

Current admin address: derived from `SOROBAN_ADMIN_SECRET_KEY` stored in GitHub secrets and local `.env`.

## 3. Distributor Roles & Key Management

### 3.1 Role Hierarchy

```
Admin (god-mode)
 ├─ pause / unpause / set_config
 ├─ add_distributor / remove_distributor
 ├─ disburse / revoke / refund / cancel_package / withdraw_surplus
 ├─ migrate
 └─ (implicitly all distributor actions)

Distributor (package manager)
 ├─ create_package / batch_create_packages
 ├─ extend_expiration
 └─ (implicitly all recipient actions)

Recipient (per-package)
 └─ claim / claim_with_proof
```

### 3.2 Distributor Key Lifecycle

**Creation:**
1. Admin generates a new Stellar keypair for each distributor
2. Admin funds the distributor address with ~5 XLM (via Friendbot)
3. Admin calls `add_distributor(addr)` on the contract (via admin key)
4. Distributor key is shared with the operator via secure channel

**Storage:** Distributor keys can be stored in:
- **Backend config**: `SOROBAN_DISTRIBUTOR_{n}_SECRET_KEY` env vars (future)
- **Per-operator wallet**: For manual CLI usage via `invoke.sh`

**Rotation:**
1. Admin generates new keypair for the replacement distributor
2. Admin calls `add_distributor(new_addr)` and optionally `remove_distributor(old_addr)`
3. Update backend env vars with the new key

**Revocation:**
1. Admin calls `remove_distributor(addr)` — immediately removes package-creation rights
2. Existing packages created by that distributor remain valid

### 3.3 Current Distributors for Testnet

| Distributor | Public Key | Role | Status |
|-------------|-----------|------|--------|
| Backend service | Derived from `SOROBAN_ADMIN_SECRET_KEY` | Package creation via admin (uses `require_admin_or_distributor`) | Active |

For testnet simplicity, the backend signs all transactions with the admin key. This key satisfies `require_admin_or_distributor`, so it can create packages without needing a separate distributor key. For mainnet, a dedicated distributor key should be used.

## 4. Upgrade Strategy

### 4.1 Categories of Change

| Category | Examples | Strategy |
|----------|----------|----------|
| **Non-breaking** | New read-only functions, bug fixes, event changes, gas optimizations | Redeploy new contract + update `CONTRACT_ID` |
| **Breaking** | Storage layout changes, function signature changes, new admin logic | Redeploy + optional off-chain state migration |
| **Configuration** | `min_amount`, `allowed_tokens`, `max_expires_in` | Admin calls `set_config()` — no redeploy needed |
| **Distributor set** | Add/remove distributors | Admin calls `add_distributor()` / `remove_distributor()` — no redeploy needed |

### 4.2 Versioning Scheme

```
Cargo.toml:        0.2.0        (semantic crate version, bumped per release)
on-chain version:  1            (integer, set by init(), bumped by migrate())
git tag:           v0.2.0-testnet (crate version + network suffix)
```

Bump order on upgrade:
1. Bump `version` in `contracts/aid_escrow/Cargo.toml`
2. Build and deploy (`deploy-testnet.sh --tag-git`)
3. Initialize the new contract with the same admin key (`initialize.sh`)
4. Run `migrate(new_version)` if on-chain data migration is needed
5. Tag the release (`git tag v<version>-testnet && git push --tags`)

### 4.3 Upgrade Procedure (Non-Breaking)

```
1. git checkout -b release/v0.3.0
2. # make changes, bump Cargo.toml version to 0.3.0
3. make test                    # all tests pass
4. make build                   # produce WASM
5. export OLD_CONTRACT_ID=$(grep CONTRACT_ID app/onchain/.env)
6. ./scripts/deploy-testnet.sh --tag-git
7. # NEW_CONTRACT_ID is printed; saved to .env and registry.json
8. ./scripts/initialize.sh --contract "$NEW_CONTRACT_ID" --admin "$ADMIN"
9. # Update downstream .env files
10. sed -i "s|AID_ESCROW_CONTRACT_ID=.*|AID_ESCROW_CONTRACT_ID=$NEW_CONTRACT_ID|" app/backend/.env
11. # Restart backend
12. # Notify team: new contract ID and version tag
```

### 4.4 Upgrade Procedure (Breaking — with State Migration)

If packages from the old contract must be preserved:

1. Follow the non-breaking procedure (steps 1–8)
2. Run an off-chain migration script that reads packages from the old contract and re-creates them in the new contract (via admin key)
3. Verify: run the smoke test harness against both old and new contract IDs
4. Update downstream systems

For testnet, a full reset (wipe DB, deploy fresh) is preferred over state migration.

### 4.5 Current Migration Stub

The contract has a `migrate(env, new_version)` function that performs version-specific data transformations. Soroban does not support in-place WASM upgrades, so `migrate()` is only useful for storage migrations within the same contract. After a redeploy, `init()` sets version to `1`; `migrate()` bumps the integer and runs the matching case:

```rust
match (current, new) {
    (1, 2) => { /* v1 → v2 migration */ }
    _      => { /* no-op */ }
}
```

## 5. Rollback Plan

### 5.1 When to Roll Back

- New deployment fails verification (smoke tests fail)
- Backend integration breaks with the new contract ID
- Critical bug discovered post-deploy
- Admin key compromise (see §2.4 rotation procedure)

### 5.2 Rollback Procedure

```
1. Identify the previous good deployment from deployments/registry.json
2. Revert CONTRACT_ID to the previous value:
     sed -i "s|AID_ESCROW_CONTRACT_ID=.*|AID_ESCROW_CONTRACT_ID=$OLD_CONTRACT_ID|" app/backend/.env
3. Restart backend:
     pnpm --filter backend start:prod
4. Verify rollback:
     node tools/testnet-smoke/index.js  # read-only checks
5. Announce the rollback in team channel with:
     - OLD contract ID (reverted to)
     - NEW contract ID (failed, archived)
     - Root cause summary
```

### 5.3 Data Consistency During Rollback

If write operations (package creations, claims) occurred against the failed contract:

1. Those transactions exist on Stellar testnet and are **not reverted**
2. The backend DB must be truncated or reconciled:
   ```bash
   # Option A: truncate and re-sync from the surviving contract
   npx prisma db push --force-reset
   # Option B: run ledger reconciliation against the old contract ID
   ```
3. Any packages created on the failed contract but not in the backend DB are orphaned — they exist on-chain but are not tracked off-chain. For testnet this is acceptable.

### 5.4 Preventing Orphaned Integrations

After every deployment or rollback, complete the checklist in `app/onchain/DEPLOY_TESTNET_RUNBOOK.md` §12 (Redeployment Checklist).

### 5.5 Rollback Test (DR Exercise)

Before every breaking-change deployment, verify the rollback plan:

```bash
# 1. Record current state
CURRENT_ID=$(grep AID_ESCROW_CONTRACT_ID app/backend/.env | cut -d= -f2)
# 2. Deploy new contract (but don't update backend yet)
NEW_ID=$(./scripts/deploy.sh --network testnet | grep "Contract ID" | awk '{print $NF}')
# 3. Initialize
./scripts/initialize.sh --contract "$NEW_ID" --admin "$ADMIN"
# 4. Run smoke tests against both
node tools/testnet-smoke/index.js  # set SOROBAN_CONTRACT_ID=$NEW_ID
# 5. Simulate rollback: point backend back to CURRENT_ID
echo "AID_ESCROW_CONTRACT_ID=$CURRENT_ID" > app/backend/.env
```

## 6. Configuration Source of Truth

### 6.1 Deploy Scripts

| Script | Env source | Action |
|--------|-----------|--------|
| `deploy.sh` | `app/onchain/.env` | Builds the WASM, deploys to `testnet`, writes `CONTRACT_ID` and `CONTRACT_VERSION` to `.env` and `registry.json` |
| `deploy-testnet.sh` | `app/onchain/.env` | Build → deploy → register in one shot. Creates git tag. |
| `initialize.sh` | `app/onchain/.env` | Calls `init(admin)` — requires `SECRET_KEY` (deployer can be admin). |
| `testnet-invoke.sh` | `app/onchain/.env` | Wraps `soroban contract invoke` for common functions. |

### 6.2 Backend Config

| Env variable | Source | Set by |
|-------------|--------|--------|
| `AID_ESCROW_CONTRACT_ID` | Deploy output | Updated after each deploy/rollback |
| `SOROBAN_ADMIN_SECRET_KEY` | Admin key generation | Set once; rotated on redeploy |
| `SOROBAN_NETWORK` | This plan | Always `testnet` |
| `STELLAR_RPC_URL` | This plan | `https://soroban-testnet.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | This plan | `Test SDF Network ; September 2015` |
| `ONCHAIN_ADAPTER` | Backend config | `soroban` for production, `mock` for local dev |

### 6.3 CI/CD (GitHub Actions)

| Secret | Used by | Set to |
|--------|---------|--------|
| `SOROBAN_CONTRACT_ID` | `testnet-smoke.yml` | Current deployed contract ID |
| `SOROBAN_ADMIN_SECRET_KEY` | `testnet-smoke.yml` | Current admin secret (matches contract admin) |
| `SOROBAN_TOKEN_ADDRESS` | `testnet-smoke.yml` | Native XLM SAC address |
| `SOROBAN_RECIPIENT_SECRET_KEY` | `testnet-smoke.yml` | Test recipient keypair |

## 7. References

- [Admin Key Policy (testnet)](./admin-key-policy-testnet.md) — key lifecycle, incident response
- [Deploy Runbook (detailed)](../app/onchain/DEPLOY_TESTNET_RUNBOOK.md) — step-by-step deploy + upgrade guidance
- [Deploy Runbook (lightweight)](./testnet-deploy-runbook.md) — quick-start deploy steps
- [Deployment Registry](../app/onchain/deployments/registry.json) — machine-readable deployment history
- [Versioning Docs](../app/onchain/contracts/aid_escrow/VERSIONING.md) — contract versioning implementation
- [Smoke Test Harness](../tools/testnet-smoke/index.js) — integration test against live testnet
- [Observability Dashboard](./testnet-observability-dashboard.md) — metrics and alerts

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-27 | 1.0 | Soter team | Initial canonical deployment plan |
