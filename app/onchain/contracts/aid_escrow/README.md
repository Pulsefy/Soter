# Aid Escrow Contract

Soroban smart contract for managing aid-package escrow on Stellar.

## What It Does

This contract allows an admin (and optionally designated distributors) to create
locked aid packages for recipients. Each package holds a specific amount of a
token until the recipient claims it, an admin disburses it, or the package
expires and is refunded.

## Public Functions

### Admin & Config

| Function | Auth | Description |
|---|---|---|
| `init(env, admin)` | None (once) | Initializes the contract with an admin address and default config. |
| `get_admin(env)` | — | Returns the current admin address. |
| `get_version(env)` | — | Returns the current contract version. |
| `migrate(env, new_version)` | Admin | Performs version-specific migrations. |
| `add_distributor(env, addr)` | Admin | Grants distributor privileges to an address. |
| `remove_distributor(env, addr)` | Admin | Revokes distributor privileges. |
| `set_config(env, config)` | Admin | Updates contract configuration (min amount, max expiry, allowed tokens). |
| `get_config(env)` | — | Returns the current config. |
| `pause(env)` | Admin | Pauses the contract (blocks package creation and claims). |
| `unpause(env)` | Admin | Unpauses the contract. |
| `is_paused(env)` | — | Returns true if the contract is paused. |

### Funding

| Function | Auth | Description |
|---|---|---|
| `fund(env, token, from, amount)` | Funder | Transfers tokens into the contract balance. This increases the available pool from which packages are locked. |

### Package Management

| Function | Auth | Description |
|---|---|---|
| `create_package(env, operator, id, recipient, amount, token, expires_at)` | Admin / Distributor | Creates a single aid package with a specific ID. Locks funds from the available pool. |
| `batch_create_packages(env, operator, recipients, amounts, token, expires_in)` | Admin / Distributor | Creates multiple packages in one transaction using auto-incrementing IDs. |
| `claim(env, id)` | Recipient | Recipient claims the package. Transfers tokens to recipient and marks package as claimed. |
| `disburse(env, id)` | Admin | Admin manually disburses a package to its recipient. |
| `revoke(env, id)` | Admin | Admin revokes a package, returning funds to the surplus pool. |
| `refund(env, id)` | Admin | Refunds an expired or cancelled package to the admin. |
| `cancel_package(env, package_id)` | Admin | Cancels a package (transitions to Cancelled status). |
| `extend_expiration(env, package_id, additional_time)` | Admin / Distributor | Extends the expiration time of an active package. |

### Queries

| Function | Auth | Description |
|---|---|---|
| `get_package(env, id)` | — | Returns full package details. |
| `view_package_status(env, id)` | — | Returns only the status (cheaper for polling). |
| `get_aggregates(env, token)` | — | Returns aggregate stats: total committed, claimed, expired/cancelled for a token. |
| `withdraw_surplus(env, token, to, amount)` | Admin | Withdraws surplus (unlocked) tokens from the contract. |

## Package Lifecycle

```
Created --> Claimed          (recipient claims)
Created --> Expired          (past expiry, recipient tries to claim)
Created --> Cancelled        (admin cancels)
Created --> Claimed (admin)  (admin disburses)
Expired --> Refunded         (admin refunds)
Cancelled --> Refunded       (admin refunds)
```

## Error Enum

| Code | Error | When It Happens |
|---|---|---|
| 1 | `NotInitialized` | Contract not initialized yet. |
| 2 | `AlreadyInitialized` | `init` called twice. |
| 3 | `NotAuthorized` | Caller lacks required role. |
| 4 | `InvalidAmount` | Amount is zero, negative, or below `min_amount`. |
| 5 | `PackageNotFound` | Package ID does not exist. |
| 6 | `PackageNotActive` | Package is not in `Created` status. |
| 7 | `PackageExpired` | Package past expiry. |
| 8 | `PackageNotExpired` | Refund attempted before expiry. |
| 9 | `InsufficientFunds` | Not enough unlocked balance to lock for package. |
| 10 | `PackageIdExists` | Duplicate ID in `create_package`. |
| 11 | `InvalidState` | Generic state violation (e.g. paused, bad config). |
| 12 | `MismatchedArrays` | `recipients` and `amounts` lengths differ in batch create. |
| 13 | `InsufficientSurplus` | `withdraw_surplus` amount exceeds available surplus. |
| 14 | `ContractPaused` | Operation blocked because contract is paused. |

## Data Structures

### `Package`

```rust
pub struct Package {
    pub id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub token: Address,
    pub status: PackageStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub metadata: Map<Symbol, String>,
}
```

### `Config`

```rust
pub struct Config {
    pub min_amount: i128,          // minimum amount per package
    pub max_expires_in: u64,       // max seconds from creation to expiry (0 = no limit)
    pub allowed_tokens: Vec<Address>, // empty = any token allowed
}
```

### `Aggregates`

```rust
pub struct Aggregates {
    pub total_committed: i128,
    pub total_claimed: i128,
    pub total_expired_cancelled: i128,
}
```

## Events

All state-changing operations emit events with stable topics and payloads optimized for off-chain indexers. Payloads are compact, exclude any dynamic maps/PII, and are structured under `EVENT_SCHEMA_VERSION = 2`.

### Schema Versioning
`EVENT_SCHEMA_VERSION` (currently `2`) is exported by the contract and should be tracked by the backend indexer to detect breaking schema updates.

### Event Definitions

- **`EscrowFunded`**: `from: Address`, `token: Address`, `amount: i128`, `timestamp: u64`
- **`PackageCreated`**: `package_id: u64`, `recipient: Address`, `amount: i128`, `token: Address`, `actor: Address`, `timestamp: u64`
- **`PackageClaimed`**: `package_id: u64`, `recipient: Address`, `amount: i128`, `token: Address`, `actor: Address`, `timestamp: u64`
- **`PackageDisbursed`**: `package_id: u64`, `recipient: Address`, `amount: i128`, `token: Address`, `actor: Address`, `timestamp: u64`
- **`PackageRevoked`**: `package_id: u64`, `recipient: Address`, `amount: i128`, `token: Address`, `actor: Address`, `timestamp: u64`
- **`PackageRefunded`**: `package_id: u64`, `recipient: Address`, `amount: i128`, `token: Address`, `actor: Address`, `timestamp: u64`
- **`BatchCreatedEvent`**: `ids: Vec<u64>`, `admin: Address`, `token: Address`, `total_amount: i128`, `timestamp: u64`
- **`ExtendedEvent`**: `id: u64`, `admin: Address`, `old_expires_at: u64`, `new_expires_at: u64`, `timestamp: u64`
- **`SurplusWithdrawnEvent`**: `to: Address`, `token: Address`, `amount: i128`, `timestamp: u64`
- **`ContractPausedEvent`**: `admin: Address`, `timestamp: u64`
- **`ContractUnpausedEvent`**: `admin: Address`, `timestamp: u64`
- **`ActionPausedEvent`**: `admin: Address`, `action: Symbol`, `timestamp: u64`
- **`ActionUnpausedEvent`**: `admin: Address`, `action: Symbol`, `timestamp: u64`


## Testing

Run the test suite:

```bash
cd app/onchain/contracts/aid_escrow
cargo test
```

See the `tests/` directory for integration, batch, event, versioning, and surplus tests.
