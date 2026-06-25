# On-Chain Module (Soroban Contracts)

This module contains Soroban smart contracts for Soter's on-chain escrow and claimable packages functionality.

## 🌐 Deployed Contract (Testnet)

| Contract      | Network | Contract ID                                                  | Docs |
| :------------ | :------ | :----------------------------------------------------------- | :--- |
| `aid_escrow`  | Testnet | `CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG`  | [Deployment Record](deployments/testnet-2026-06-03.md) |

[View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG) · [View on Stellar Lab](https://lab.stellar.org/r/testnet/contract/CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG)

## 🧠 AidEscrow Contract

The **AidEscrow** contract facilitates secure, transparent aid disbursement. Packages are created for specific recipients with locked funds, and can be disbursed by administrators.

### Core Invariants
* **Pool Model:** Funds must be deposited into the contract via `fund()` before they can be allocated to packages.
* **Solvency:** A package cannot be created if `Contract Balance < Total Locked Amount + New Package Amount`.
* **State Machine:** A package transitions through various statuses: `Created` -> `Claimed` (or `Expired`, `Cancelled` -> `Refunded`).
* **Time-Bounds:** Packages can have expiration times. Claiming is blocked after expiration.
* **Admin Sovereignty:** Only the admin or authorized distributors can create packages. Only the admin can pause, configure, or manually disburse funds.

### Event schema (indexer-friendly)

Events use **stable topic identifiers** (struct name in snake_case) so indexers and dashboards can filter reliably. Payloads are compact; no PII. Do not rename event types without a versioning strategy.

| Event type (topic) | When emitted | Fields |
| :--- | :--- | :--- |
| `escrow_funded` | Pool is funded | `from`, `token`, `amount`, `timestamp` |
| `package_created` | Package created | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_claimed` | Recipient claims package | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_disbursed` | Admin disburses to recipient | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_revoked` | Package cancelled/revoked | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_refunded` | Funds refunded to admin | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `batch_created_event` | Batch of packages created | `ids`, `admin`, `total_amount` |
| `extended_event` | Package expiry extended | `id`, `admin`, `old_expires_at`, `new_expires_at` |
| `surplus_withdrawn_event` | Surplus funds withdrawn | `to`, `token`, `amount` |

**Sample (package_created):**
```json
{
  "topics": ["package_created"],
  "data": {
    "package_id": 1,
    "recipient": "<address>",
    "amount": "1000000000",
    "actor": "<address>",
    "timestamp": 1234567890
  }
}
```

### Method Reference

| Method | Description | Auth Required |
| :--- | :--- | :--- |
| `init(admin)` | Initializes the contract and sets the admin. | None |
| `fund(token, from, amount)` | Deposits funds into the contract pool. | `from` |
| `create_package(operator, id, recipient, amount, token, expires_at)` | Creates a package with a manual ID. | `admin` or `distributor` |
| `batch_create_packages(operator, recipients, amounts, token, expires_in)` | Creates multiple packages with auto-incremented IDs. | `admin` or `distributor` |
| `claim(id)` | Recipient claims their allocated funds. | `recipient` |
| `disburse(id)` | Admin manually sends package funds to recipient. | `admin` |
| `revoke(id)` / `cancel_package(id)` | Cancels an active package and unlocks funds. | `admin` |
| `refund(id)` | Returns funds from an expired/cancelled package to admin. | `admin` |
| `extend_expiration(id, additional_time)` | Extends the expiration of a package. | `admin` |
| `withdraw_surplus(to, amount, token)` | Withdraws unallocated (non-locked) funds. | `admin` |
| `add_distributor(addr)` | Grants distributor rights to an address. | `admin` |
| `remove_distributor(addr)` | Revokes distributor rights. | `admin` |
| `pause()` / `unpause()` | Pauses/Unpauses contract operations. | `admin` |
| `set_config(config)` | Updates global limits (min amount, max expiry). | `admin` |
| `get_package(id)` | Returns full package details. | None |
| `view_package_status(id)` | Returns only the status of a package. | None |
| `get_aggregates(token)` | Returns total committed/claimed/expired stats. | None |

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WebAssembly target (Stellar CLI 26+)
rustup target add wasm32v1-none

# Install Stellar CLI
cargo install --locked stellar-cli
```

### Testnet invoke scripts

Use `scripts/testnet-invoke.sh` for repeatable Testnet calls against the
`aid_escrow` contract. The script loads `CONTRACT_ID`, `SOURCE_ACCOUNT`,
`SECRET_KEY`, `DEPLOYER_SECRET_KEY`, and `TESTNET_RPC_URL` from `.env`, and
also accepts those values as flags. Secrets are redacted in the printed command.

```bash
# Initialize the deployed contract.
./scripts/testnet-invoke.sh initialize --admin GADMIN...

# Create a package.
./scripts/testnet-invoke.sh create-package \
  --operator GADMIN... \
  --id 1 \
  --recipient GRECIPIENT... \
  --amount 10000000 \
  --token CTOKEN...

# Claim and inspect package state.
./scripts/testnet-invoke.sh claim --id 1
./scripts/testnet-invoke.sh get-package --id 1
./scripts/testnet-invoke.sh view-status --id 1
./scripts/testnet-invoke.sh get-aggregates --token CTOKEN...
```
