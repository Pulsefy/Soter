# aid_escrow — Soroban Smart Contract

A Soroban smart contract that implements a **pool-based aid escrow** on the Stellar network. NGOs and distributors fund a shared token pool, create claimable packages for individual recipients, and recipients (or admins) redeem them on-chain. Every state change is recorded as an immutable ledger event.

---

## How It Works

```
Funder ──fund()──► Contract Pool
                        │
Operator ──create_package()──► Package (Created, funds locked)
                        │
Recipient ──claim()──► Package (Claimed, funds transferred)
```

1. A funder calls `fund()` to deposit tokens into the contract.
2. An admin or distributor calls `create_package()` (or `batch_create_packages()`) to lock a portion of the pool for a specific recipient.
3. The recipient calls `claim()` to receive their tokens. Alternatively, the admin can push funds via `disburse()`.
4. Unclaimed packages can be cancelled (`revoke` / `cancel_package`) or refunded to the admin after expiry.

---

## Package State Machine

```
Created ──claim() / disburse()──► Claimed
Created ──revoke() / cancel_package()──► Cancelled ──refund()──► Refunded
Created ──(expires_at passed)──► Expired ──refund()──► Refunded
```

A package in `Claimed` or `Refunded` status is terminal and cannot be modified.

---

## Public Functions

### Initialisation

#### `init(env, admin)`
Initialises the contract. Must be called exactly once.

| Argument | Type      | Description                          |
|----------|-----------|--------------------------------------|
| `admin`  | `Address` | Address granted admin privileges.    |

Errors: `AlreadyInitialized`

---

### Configuration

#### `get_admin(env) → Address`
Returns the stored admin address.

Errors: `NotInitialized`

#### `set_config(env, config)`
Replaces the contract configuration. Admin only.

| Argument | Type     | Description                                                                 |
|----------|----------|-----------------------------------------------------------------------------|
| `config` | `Config` | `min_amount` (i128), `max_expires_in` (u64 seconds, 0 = unlimited), `allowed_tokens` (Vec\<Address\>, empty = all allowed). |

Errors: `NotInitialized`, `NotAuthorized`, `InvalidAmount`

#### `get_config(env) → Config`
Returns the current configuration (read-only, no auth required).

#### `add_distributor(env, addr)` / `remove_distributor(env, addr)`
Grants or revokes distributor privileges. Admin only. Distributors may call `create_package` and `batch_create_packages`.

Errors: `NotInitialized`, `NotAuthorized`

#### `pause(env)` / `unpause(env)`
Halts or resumes `fund`, `create_package`, `batch_create_packages`, and `claim`. Admin only.

Errors: `NotInitialized`, `NotAuthorized`

#### `is_paused(env) → bool`
Returns `true` when the contract is paused (read-only).

---

### Funding

#### `fund(env, token, from, amount)`
Deposits tokens into the contract pool.

| Argument | Type      | Description                                      |
|----------|-----------|--------------------------------------------------|
| `token`  | `Address` | SEP-41 token contract address.                   |
| `from`   | `Address` | Funding address; must authorise this call.       |
| `amount` | `i128`    | Amount to deposit (must be > 0).                 |

Errors: `InvalidAmount`

---

### Package Management

#### `create_package(env, operator, id, recipient, amount, token, expires_at) → u64`
Creates a single aid package and locks funds from the pool.

| Argument     | Type      | Description                                                          |
|--------------|-----------|----------------------------------------------------------------------|
| `operator`   | `Address` | Admin or distributor; must authorise this call.                      |
| `id`         | `u64`     | Caller-supplied unique package ID.                                   |
| `recipient`  | `Address` | Address entitled to claim the package.                               |
| `amount`     | `i128`    | Token amount to lock (must be ≥ `config.min_amount`).                |
| `token`      | `Address` | SEP-41 token contract address.                                       |
| `expires_at` | `u64`     | Unix timestamp after which the package expires (`0` = no expiry).   |

Returns the package `id` on success.

Errors: `ContractPaused`, `NotAuthorized`, `InvalidAmount`, `InvalidState`, `PackageIdExists`, `InsufficientFunds`

#### `batch_create_packages(env, operator, recipients, amounts, token, expires_in) → Vec<u64>`
Creates multiple packages in one transaction using auto-incremented IDs.

| Argument     | Type            | Description                                                    |
|--------------|-----------------|----------------------------------------------------------------|
| `operator`   | `Address`       | Admin or distributor; must authorise this call.                |
| `recipients` | `Vec<Address>`  | Ordered list of recipient addresses.                           |
| `amounts`    | `Vec<i128>`     | Ordered list of amounts, one per recipient.                    |
| `token`      | `Address`       | SEP-41 token contract address.                                 |
| `expires_in` | `u64`           | Seconds from now until all packages in this batch expire.      |

Returns a `Vec<u64>` of the created package IDs.

Errors: `ContractPaused`, `NotAuthorized`, `MismatchedArrays`, `InvalidAmount`, `InsufficientFunds`

---

### Recipient Actions

#### `claim(env, id)`
Recipient claims their package. Transfers locked tokens to the recipient.

| Argument | Type  | Description              |
|----------|-------|--------------------------|
| `id`     | `u64` | Package ID to claim.     |

The recipient address stored in the package must authorise this call.

Errors: `ContractPaused`, `PackageNotFound`, `PackageNotActive`, `PackageExpired`

---

### Admin Actions

#### `disburse(env, id)`
Admin pushes funds to the recipient without requiring the recipient's signature. Useful for field operations.

Errors: `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `PackageNotActive`

#### `revoke(env, id)`
Cancels a `Created` package and returns its funds to the pool.

Errors: `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `InvalidState`

#### `cancel_package(env, package_id)`
Cancels a `Created` package that has not yet expired. Funds return to the pool.

Errors: `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `PackageNotActive`, `PackageExpired`

#### `refund(env, id)`
Transfers the package amount back to the admin. Only valid for `Expired` or `Cancelled` packages.

Errors: `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `InvalidState`

#### `extend_expiration(env, package_id, additional_time)`
Extends the expiry of a `Created` package by `additional_time` seconds. Cannot extend unbounded packages (`expires_at == 0`).

Errors: `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `PackageNotActive`, `InvalidAmount`, `InvalidState`, `PackageExpired`

#### `withdraw_surplus(env, to, amount, token)`
Withdraws unallocated (surplus) tokens from the contract to `to`. Surplus = contract balance − total locked.

Errors: `NotInitialized`, `NotAuthorized`, `InvalidAmount`, `InsufficientSurplus`

---

### Read-Only Queries

#### `get_package(env, id) → Package`
Returns the full `Package` struct for the given ID.

Errors: `PackageNotFound`

#### `get_aggregates(env, token) → Aggregates`
Returns aggregate token statistics across all packages:

| Field                    | Description                                              |
|--------------------------|----------------------------------------------------------|
| `total_committed`        | Sum of amounts in `Created` packages.                    |
| `total_claimed`          | Sum of amounts in `Claimed` packages.                    |
| `total_expired_cancelled`| Sum of amounts in `Expired`, `Cancelled`, or `Refunded`. |

---

## Error Reference

| Code | Variant                | When it is returned                                                    |
|------|------------------------|------------------------------------------------------------------------|
| 1    | `NotInitialized`       | Contract has not been initialised via `init`.                          |
| 2    | `AlreadyInitialized`   | `init` was called more than once.                                      |
| 3    | `NotAuthorized`        | Caller lacks the required role (admin or distributor).                 |
| 4    | `InvalidAmount`        | Amount is ≤ 0, below `min_amount`, or `additional_time` is 0.         |
| 5    | `PackageNotFound`      | No package exists for the given ID.                                    |
| 6    | `PackageNotActive`     | Package status is not `Created`.                                       |
| 7    | `PackageExpired`       | Package has passed its `expires_at` timestamp.                         |
| 8    | `PackageNotExpired`    | Operation requires the package to be expired, but it is not.           |
| 9    | `InsufficientFunds`    | Contract pool balance cannot cover the requested lock amount.          |
| 10   | `PackageIdExists`      | A package with the supplied ID already exists.                         |
| 11   | `InvalidState`         | General state violation (token not allowed, expiry out of range, etc). |
| 12   | `MismatchedArrays`     | `recipients` and `amounts` arrays have different lengths.              |
| 13   | `InsufficientSurplus`  | Requested withdrawal exceeds unallocated contract balance.             |
| 14   | `ContractPaused`       | Contract is paused; mutating operations are blocked.                   |

---

## Events

| Event                    | Emitted by                          | Key fields                              |
|--------------------------|-------------------------------------|-----------------------------------------|
| `FundEvent`              | `fund`                              | `from`, `token`, `amount`               |
| `PackageCreatedEvent`    | `create_package`, `batch_create_packages` | `id`, `recipient`, `amount`       |
| `ClaimedEvent`           | `claim`                             | `id`, `recipient`, `amount`             |
| `DisbursedEvent`         | `disburse`                          | `id`, `admin`, `amount`                 |
| `RevokedEvent`           | `revoke`, `cancel_package`          | `id`, `admin`, `amount`                 |
| `RefundedEvent`          | `refund`                            | `id`, `admin`, `amount`                 |
| `BatchCreatedEvent`      | `batch_create_packages`             | `ids`, `admin`, `total_amount`          |
| `ExtendedEvent`          | `extend_expiration`                 | `id`, `admin`, `old_expires_at`, `new_expires_at` |
| `SurplusWithdrawnEvent`  | `withdraw_surplus`                  | `to`, `token`, `amount`                 |
| `ContractPausedEvent`    | `pause`                             | `admin`                                 |
| `ContractUnpausedEvent`  | `unpause`                           | `admin`                                 |

---

## Building & Testing

```bash
# From app/onchain/
make build        # cargo build --target wasm32-unknown-unknown --release
make test         # cargo test
make deploy       # see scripts/deploy.sh for env vars required
```

See [`app/onchain/README.md`](../../README.md) for full CLI setup and deployment instructions.
