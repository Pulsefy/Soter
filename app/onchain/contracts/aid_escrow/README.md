# AidEscrow Contract

A Soroban smart contract for managing aid package escrow on the Stellar blockchain. This contract enables secure, transparent aid disbursement where packages are created for specific recipients with locked funds.

## Overview

The AidEscrow contract provides a trustless mechanism for:
- Creating aid packages with locked funds
- Allowing recipients to claim their aid packages
- Admin management of packages (disbursement, cancellation, extension)
- Withdrawing unallocated surplus funds

### Core Invariants

- **Solvency**: A package cannot be created if `Contract Balance < Total Locked Amount + New Package Amount`
- **State Machine**: A package transitions through states: `Created` → `Claimed` (or `Expired`/`Cancelled`/`Refunded`)
- **Time-Bounds**: Packages can have expiration timestamps
- **Admin Sovereignty**: Only the admin or authorized distributors can create packages and manage funds

## Public Functions

### Initialization & Admin

| Function | Description | Auth Required |
|----------|-------------|----------------|
| `init(admin)` | Initializes contract with admin address (one-time) | None |
| `get_admin()` | Returns the admin address | None |
| `add_distributor(addr)` | Adds an address that can create packages | Admin |
| `remove_distributor(addr)` | Removes a distributor | Admin |
| `set_config(config)` | Sets contract configuration | Admin |
| `pause()` | Pauses package creation and claims | Admin |
| `unpause()` | Resumes contract operations | Admin |
| `is_paused()` | Returns whether contract is paused | None |
| `get_config()` | Returns current configuration | None |

### Funding & Package Creation

| Function | Description | Auth Required |
|----------|-------------|----------------|
| `fund(token, from, amount)` | Funds the contract pool | Caller (funds source) |
| `create_package(operator, id, recipient, amount, token, expires_at)` | Creates a package with specific ID | Admin/Distributor |
| `batch_create_packages(operator, recipients, amounts, token, expires_in)` | Creates multiple packages | Admin/Distributor |

### Recipient Actions

| Function | Description | Auth Required |
|----------|-------------|----------------|
| `claim(id)` | Recipient claims their package | Recipient |

### Admin Actions

| Function | Description | Auth Required |
|----------|-------------|----------------|
| `disburse(id)` | Admin disburses to recipient | Admin |
| `revoke(id)` | Cancels a package, unlocks funds | Admin |
| `refund(id)` | Refunds expired/cancelled package to admin | Admin |
| `cancel_package(package_id)` | Cancels a non-expired package | Admin |
| `extend_expiration(package_id, additional_time)` | Extends package expiration | Admin |
| `withdraw_surplus(to, amount, token)` | Withdraws unallocated funds | Admin |

### Read-Only Functions

| Function | Description |
|----------|-------------|
| `get_package(id)` | Returns package details by ID |
| `get_aggregates(token)` | Returns aggregate statistics for a token |

## Error Semantics

| Error | Code | Description |
|-------|------|-------------|
| `NotInitialized` | 1 | Contract has not been initialized |
| `AlreadyInitialized` | 2 | Contract was already initialized |
| `NotAuthorized` | 3 | Caller lacks required permissions |
| `InvalidAmount` | 4 | Amount is zero, negative, or below minimum |
| `PackageNotFound` | 5 | Package with given ID does not exist |
| `PackageNotActive` | 6 | Package is not in `Created` status |
| `PackageExpired` | 7 | Package has passed its expiration time |
| `PackageNotExpired` | 8 | Package has not expired yet (for operations requiring expired packages) |
| `InsufficientFunds` | 9 | Contract has insufficient balance for operation |
| `PackageIdExists` | 10 | Package with given ID already exists |
| `InvalidState` | 11 | Operation invalid for current package/state |
| `MismatchedArrays` | 12 | Array lengths don't match (batch operations) |
| `InsufficientSurplus` | 13 | Requested withdrawal exceeds available surplus |
| `ContractPaused` | 14 | Contract is currently paused |

## Data Types

### PackageStatus

```
rust
enum PackageStatus {
    Created = 0,    // Package created, funds locked
    Claimed = 1,   // Funds disbursed to recipient
    Expired = 2,   // Package expired without being claimed
    Cancelled = 3, // Package cancelled by admin
    Refunded = 4,  // Funds refunded to admin
}
```

### Package

```
rust
struct Package {
    id: u64,           // Unique package identifier
    recipient: Address, // Address that can claim the funds
    amount: i128,     // Token amount
    token: Address,   // Token contract address
    status: PackageStatus,
    created_at: u64,  // Creation timestamp
    expires_at: u64,  // Expiration timestamp (0 = never expires)
    metadata: Map<Symbol, String>, // Optional metadata
}
```

### Config

```
rust
struct Config {
    min_amount: i128,       // Minimum package amount
    max_expires_in: u64,    // Maximum expiration window (0 = unlimited)
    allowed_tokens: Vec<Address>, // Allowed token addresses (empty = any)
}
```

### Aggregates

```
rust
struct Aggregates {
    total_committed: i128,       // Sum of Created packages
    total_claimed: i128,         // Sum of Claimed packages
    total_expired_cancelled: i128, // Sum of Expired/Cancelled/Refunded
}
```

## Events

| Event | Fields | Description |
|-------|--------|-------------|
| `FundEvent` | `from`, `token`, `amount` | Tokens funded to contract |
| `PackageCreatedEvent` | `id`, `recipient`, `amount` | New package created |
| `ClaimedEvent` | `id`, `recipient`, `amount` | Package claimed by recipient |
| `DisbursedEvent` | `id`, `admin`, `amount` | Package disbursed by admin |
| `RevokedEvent` | `id`, `admin`, `amount` | Package revoked/cancelled |
| `RefundedEvent` | `id`, `admin`, `amount` | Package refunded to admin |
| `BatchCreatedEvent` | `ids`, `admin`, `total_amount` | Batch packages created |
| `ExtendedEvent` | `id`, `admin`, `old_expires_at`, `new_expires_at` | Expiration extended |
| `SurplusWithdrawnEvent` | `to`, `token`, `amount` | Surplus funds withdrawn |
| `ContractPausedEvent` | `admin` | Contract paused |
| `ContractUnpausedEvent` | `admin` | Contract unpaused |

## Usage Example

### Initialize Contract

```
rust
// Initialize with admin
client.init(&admin);
```

### Create Package

```
rust
// Set config first
client.set_config(&Config {
    min_amount: 1000,
    max_expires_in: 86400 * 30, // 30 days
    allowed_tokens: Vec::new(&env),
});

// Fund the contract
client.fund(&token, &funder, &10_000_000);

// Create a package
let package_id = client.create_package(
    &admin,
    &1u64,
    &recipient,
    &5000,
    &token,
    &expire_timestamp,
);
```

### Claim Package

```
rust
// Recipient claims their package
client.claim(&package_id);
```

## Security Considerations

1. **Authorization**: All sensitive operations require admin authentication or distributor privileges
2. **Pausability**: Emergency pause functionality for security incidents
3. **Solvency Checks**: Contract prevents over-promising funds
4. **Re-entrancy Protection**: State updates occur before external calls
5. **Input Validation**: All inputs are validated before execution
