# On-Chain Module (Soroban Contracts)

This module contains Soroban smart contracts for Soter's on-chain escrow and claimable packages functionality.

## 🧠 AidEscrow Contract

The **AidEscrow** contract facilitates secure, transparent aid disbursement. Packages are created for specific recipients with locked funds, and can be disbursed by administrators.

### Core Invariants
* **Solvency:** A package cannot be created if `Contract Balance < Total Locked Amount + New Package Amount`.
* **State Machine:** A package transitions from `Created` to `Claimed` when disbursed.
* **Time-Bounds:** Packages can have expiration times.
* **Admin Sovereignty:** Only the admin or authorized distributors can create packages and disburse funds.

### Event schema (indexer-friendly)

Events use **stable topic identifiers** (struct name in snake_case) so indexers and dashboards can filter reliably. Payloads are compact; no PII. Do not rename event types without a versioning strategy.

| Event type (topic) | When emitted | Fields |
| :--- | :--- | :--- |
| `escrow_funded` | Pool is funded | `from`, `token`, `amount`, `timestamp` |
| `package_created` | Package created | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_claimed` | Recipient claims package | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_disbursed` | Admin disburses to recipient | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_revoked` | Package cancelled/revoked | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |
| `package_refunded` | Funds refunded to admin (after expire/cancel) | `package_id`, `recipient`, `amount`, `actor`, `timestamp` |

**Field semantics**
- `package_id` — unique package identifier (u64).
- `amount` — token amount (i128).
- `recipient` — package recipient address (for claim/disburse/revoke/refund).
- `actor` — address that triggered the transition (funder, operator, recipient, or admin).
- `timestamp` — ledger timestamp when the event was emitted (u64).
- **Reserved for future:** `campaign_ref` (optional) may be added for campaign attribution; indexers should ignore unknown fields.

**Versioning:** New optional fields may be added; existing field names and types are stable.

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
| `init(admin)` | Initializes the contract. Must be called once. | None |
| `create_package(operator, id, recipient, amount, token, expires_at)` | Creates a package locking funds for a recipient. | `admin` or `distributor` |
| `disburse(id)` | Admin manually disburses funds to the recipient. | `admin` |

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf [https://sh.rustup.rs](https://sh.rustup.rs) | sh

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli