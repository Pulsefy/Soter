# On-Chain Module (Soroban Contracts)

This module contains Soroban smart contracts for Soter's on-chain escrow and claimable packages functionality.

## 🧠 AidEscrow Contract (v1)

The **AidEscrow** contract facilitates secure, transparent aid disbursement. It operates on a **Pool Model**, where the contract holds a global balance of tokens, and "Packages" simply lock portions of that balance for specific recipients.

### Core Invariants
* **Solvency:** A package cannot be created if `Contract Balance < Total Locked Amount + New Package Amount`.
* **State Machine:** A package can only be claimed, revoked, or refunded if it is in the `Created` state.
* **Time-Bounds:** Claims are rejected if `Ledger Timestamp > Expires At`.
* **Admin Sovereignty:** Only the admin can `disburse` (manual release), `revoke` (cancel), or `refund` (withdraw).

### Method Reference

| Method | Description | Auth Required |
| :--- | :--- | :--- |
| `init(admin)` | Initializes the contract. Must be called once. | None |
| `fund(token, from, amount)` | Deposits funds into the contract pool. | `from` |
| `create_package(...)` | Locks funds from the pool for a specific recipient. | `admin` |
| `claim(id)` | Recipient withdraws their locked funds. | `recipient` |
| `disburse(id)` | Admin manually pushes funds to recipient (overrides claim). | `admin` |
| `revoke(id)` | Cancels a package and unlocks funds back to the pool. | `admin` |
| `refund(id)` | Withdraws funds from an `Expired` or `Cancelled` package to Admin. | `admin` |

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf [https://sh.rustup.rs](https://sh.rustup.rs) | sh

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli