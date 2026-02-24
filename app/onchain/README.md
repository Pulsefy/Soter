# On-Chain Module (Soroban Contracts)

This module contains Soroban smart contracts for Soter's on-chain escrow and claimable packages functionality.

## 🧠 AidEscrow Contract (v1)

The **AidEscrow** contract facilitates secure, transparent aid disbursement. It operates on a **Pool Model**, where the contract holds a global balance of tokens, and "Packages" simply lock portions of that balance for specific recipients.

### Core Invariants
* **Solvency:** A package cannot be created if `Contract Balance < Total Locked Amount + New Package Amount`.
* **State Machine:** A package can only be claimed, revoked, or refunded if it is in the `Created` state.
* **Time-Bounds:** Claims are rejected if `Ledger Timestamp > Expires At`.
* **Admin Sovereignty:** Only the admin can `disburse` (manual release), `revoke` (cancel), or `refund` (withdraw).

### Data Structures

#### Package
Represents a locked allocation of funds for a specific recipient.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `u64` | Unique package identifier |
| `recipient` | `Address` | Address of the intended recipient |
| `amount` | `i128` | Amount of tokens locked for this package |
| `token` | `Address` | Token contract address |
| `status` | `PackageStatus` | Current status of the package |
| `created_at` | `u64` | Timestamp when package was created |
| `expires_at` | `u64` | Expiration timestamp (0 for no expiration) |
| `metadata` | `Map<Symbol, String>` | Additional metadata key-value pairs |

#### PackageStatus
Enum representing the lifecycle state of a package.

| Variant | Value | Description |
| :--- | :--- | :--- |
| `Created` | 0 | Package is active and can be claimed |
| `Claimed` | 1 | Package has been claimed by recipient |
| `Expired` | 2 | Package has expired and cannot be claimed |
| `Cancelled` | 3 | Package was cancelled by admin |
| `Refunded` | 4 | Package funds were refunded to admin |

#### Config
Contract configuration parameters.

| Field | Type | Description |
| :--- | :--- | :--- |
| `min_amount` | `i128` | Minimum amount allowed for package creation |
| `max_expires_in` | `u64` | Maximum expiration duration in seconds (0 for unlimited) |
| `allowed_tokens` | `Vec<Address>` | List of allowed token addresses (empty for all tokens) |

#### Aggregates
Aggregate statistics for a specific token.

| Field | Type | Description |
| :--- | :--- | :--- |
| `total_committed` | `i128` | Sum of amounts in `Created` status |
| `total_claimed` | `i128` | Sum of amounts in `Claimed` status |
| `total_expired_cancelled` | `i128` | Sum of amounts in `Expired`, `Cancelled`, or `Refunded` status |

### Method Reference

| Method | Description | Auth Required |
| :--- | :--- | :--- |
| `init(admin)` | Initializes the contract. Must be called once. | None |
| `get_admin()` | Returns the admin address of the contract. | None |
| `set_config(config)` | Updates contract configuration (min_amount, max_expires_in, allowed_tokens). | `admin` |
| `get_config()` | Returns the current contract configuration. | None |
| `fund(token, from, amount)` | Deposits funds into the contract pool. | `from` |
| `create_package(id, recipient, amount, token, expires_at)` | Locks funds from the pool for a specific recipient with a given ID. | `admin` |
| `batch_create_packages(recipients, amounts, token, expires_in)` | Creates multiple packages in a single transaction using auto-incrementing IDs. | `admin` |
| `claim(id)` | Recipient withdraws their locked funds. | `recipient` |
| `disburse(id)` | Admin manually pushes funds to recipient (overrides claim). | `admin` |
| `revoke(id)` | Cancels a package and unlocks funds back to the pool. | `admin` |
| `refund(id)` | Withdraws funds from an `Expired` or `Cancelled` package to Admin. | `admin` |
| `cancel_package(package_id)` | Admin cancels a package in `Created` state, unlocking funds to pool. | `admin` |
| `extend_expiration(package_id, additional_time)` | Admin extends the expiration time of a package by adding additional seconds. | `admin` |
| `get_package(id)` | Returns the package details for a given ID. | None |
| `get_aggregates(token)` | Returns aggregate statistics (committed, claimed, expired/cancelled) for a token. | None |

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf [https://sh.rustup.rs](https://sh.rustup.rs) | sh

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli