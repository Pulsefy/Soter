# On-Chain Module (Soroban Contracts)

This module contains Soroban smart contracts for Soter's on-chain escrow and claimable packages functionality.

## 🏗️ Architecture

The current implementation uses a **package-based aid escrow model** where:
- Admin creates aid packages for specific recipients
- Each package has a unique ID and contains amount, token, expiry, and metadata
- Recipients claim packages using their address authentication
- Packages have statuses: `Created`, `Claimed`, `Expired`, `Cancelled`
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
```

## 📋 Contract API

### `AidEscrow` Contract

#### Methods

##### `initialize(env: Env, admin: Address) -> Result<(), Error>`
Initialize the contract with an admin address.

##### `get_admin(env: Env) -> Result<Address, Error>`
Get the current admin address.

##### `create_package(env: Env, recipient: Address, amount: i128, token: Address, expires_in: u64) -> Result<u64, Error>`
Create a new aid package. Only callable by admin.

**Arguments:**
- `recipient` - Address of the package recipient
- `amount` - Token amount to escrow
- `token` - Token contract address
- `expires_in` - Expiration time in seconds (0 for no expiry)

**Returns:** Package ID (u64)

**Errors:**
- `NotAuthorized` - Caller is not admin
- `InvalidAmount` - Amount is zero or negative

##### `claim_package(env: Env, package_id: u64) -> Result<(), Error>`
Claim an aid package. Only callable by the recipient.

**Arguments:**
- `package_id` - ID of the package to claim

**Errors:**
- `PackageNotFound` - Package doesn't exist
- `PackageAlreadyClaimed` - Package was already claimed
- `PackageExpired` - Package has expired

##### `get_package(env: Env, package_id: u64) -> Result<Option<(Address, i128, Address, u32, u64, u64)>, Error>`
Get package details by ID.

**Returns:** Tuple of (recipient, amount, token, status, created_at, expires_at)

##### `get_package_count(env: Env) -> Result<u64, Error>`
Get total number of packages created.

### Error Types

```rust
pub enum Error {
    NotAuthorized = 1,
    InvalidAmount = 2,
    PackageNotFound = 3,
    PackageAlreadyClaimed = 4,
    PackageExpired = 5,
}
```

### Package Status

```rust
pub enum PackageStatus {
    Created = 0,
    Claimed = 1,
    Expired = 2,
    Cancelled = 3,
}
```

## 🧪 Testing

```bash
# Run all tests
cargo test

# Run with output
cargo test -- --nocapture

# Run integration tests only
cargo test --test integration
```

## 📝 Usage Example

```rust
use aid_escrow::{AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{Env, Address};

// Setup
let env = Env::default();
let admin = Address::generate(&env);
let recipient = Address::generate(&env);
let token = Address::generate(&env);

let contract_id = env.register(AidEscrow, ());
let client = AidEscrowClient::new(&env, &contract_id);

// Initialize
client.initialize(&admin);

// Create package (admin auth required)
env.mock_all_auths();
let package_id = client.create_package(&recipient, &1000, &token, &86400).unwrap();

// Claim package (recipient auth required)
env.mock_all_auths();
client.claim_package(&package_id).unwrap();

// Verify
let package = client.get_package(&package_id).unwrap();
assert_eq!(package.status, PackageStatus::Claimed);
```

## 🔧 Build & Deploy

```bash
# Build the contract
cargo build --target wasm32-unknown-unknown --release

# Or use the Makefile
make build

# Deploy (requires .env with SECRET_KEY)
make deploy

# Invoke contract functions
make invoke FUNCTION=create_package ARGS="GBRECIPIENT... 1000 GBTOKEN..."
```

## 📁 Project Structure

```
app/onchain/
├── contracts/
│   └── aid_escrow/
│       ├── src/
│       │   └── lib.rs          # Contract implementation
│       └── tests/
│           └── integration.rs  # Integration tests
├── scripts/
│   ├── deploy.sh               # Deployment script
│   └── invoke.sh               # Contract invocation script
├── Makefile                    # Build automation
└── README.md                   # This file
```

## 🔒 Security Considerations

- Only the admin can create packages
- Only the designated recipient can claim a package
- Package amounts must be positive
- Expired packages cannot be claimed
- All state changes require proper authorization