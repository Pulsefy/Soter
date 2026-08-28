# Contributing to On-Chain Contracts

Welcome! This document outlines how to contribute to Soter's on-chain contracts.

## 📋 Code Standards

### Rust Style Guide

- Follow the [Rust Style Guide](https://doc.rust-lang.org/nightly/style-guide/)
- Use `cargo fmt` before committing
- No warnings allowed (`cargo clippy -- -D warnings`)

### Contract-Specific Standards

- **Naming**:
  - Structs: `PascalCase` (e.g., `AidEscrow`)
  - Functions: `snake_case` (e.g., `create_package`)
  - Constants: `SCREAMING_SNAKE_CASE` (e.g., `MAX_PACKAGE_AMOUNT`)
- **Storage**: Use descriptive keys, avoid collisions
- **Errors**: Use custom error types, not string literals

### Documentation

```rust
/// Creates a new aid package
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `operator` - Address of the admin or distributor creating the package
/// * `id` - Unique package ID
/// * `recipient` - Address of the recipient
/// * `amount` - Amount to escrow
/// * `token` - Token contract address
/// * `expires_at` - Expiration timestamp (0 for no expiration)
///
/// # Returns
/// * `Result<u64, Error>` - Package ID on success
///
/// # Errors
/// Returns `Error::InvalidAmount` if amount is zero or negative
/// Returns `Error::PackageIdExists` if ID already exists
/// Returns `Error::InsufficientFunds` if contract lacks sufficient balance
pub fn create_package(
    env: Env,
    operator: Address,
    id: u64,
    recipient: Address,
    amount: i128,
    token: Address,
    expires_at: u64,
) -> Result<u64, Error> {
    // implementation
}
```

## 🔄 TypeScript Type Generation

Contract changes require TypeScript type updates to prevent runtime type drift. Types are auto-generated from the Rust contract definitions.

### When to Generate Types

Generate types whenever you change:
- Contract `#[contracttype]` structs or enums
- Contract error codes (`#[contracterror]`)
- Contract events (`#[contractevent]`)

### How to Generate Types

From the project root:
```bash
npm run generate:contract-types
```

Or from the backend directory:
```bash
cd app/backend
npm run generate:contract-types
```

Or manually using Node:
```bash
cd app/onchain
node scripts/generate-types.mjs --contract aid_escrow
```

### Generated Files

- **Location**: `app/backend/src/types/aid_escrow.generated.ts`
- **Do not edit**: This file is auto-generated. Changes will be overwritten.
- **Exported**: Types are re-exported via `app/backend/src/types/index.ts`

### CI Verification

The CI pipeline automatically verifies that committed TypeScript types match the current Rust contract definition. PRs will fail if:
- Types are out of sync with the contract
- Generated types were not committed

Run this locally before pushing:
```bash
node app/onchain/scripts/verify-types.mjs --contract aid_escrow
```

## ✅ CI/CD & Testing

We enforce strict quality types. Before submitting a PR, ensure you have:

1. **Formatted Code**: `cargo fmt --check` must pass.
2. **No Clippy Warnings**: `cargo clippy -- -D warnings` must pass.
3. **Tests Pass**: `cargo test` must pass (unit and integration).
4. **Types Current**: Run `npm run generate:contract-types` and commit any changes
5. **Type Verification**: `node app/onchain/scripts/verify-types.mjs` exits with code 0

## 📝 PR Checklist

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with `cargo test`
- [ ] I have regenerated TypeScript types if I changed contract types/errors/events
- [ ] Type verification passes: `node app/onchain/scripts/verify-types.mjs`

