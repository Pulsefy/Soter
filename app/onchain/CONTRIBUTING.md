
### **5. `app/onchain/CONTRIBUTING.md`** (Contributor guidelines)
```markdown
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
/// * `recipient` - Address of the recipient
/// * `amount` - Amount to escrow (must be > 0)
/// * `token` - Token contract address
/// * `expires_in` - Expiration time in seconds (0 for no expiry)
///
/// # Returns
/// * `u64` - Package ID
///
/// # Errors
/// Returns `Error::NotAuthorized` if caller is not admin
/// Returns `Error::InvalidAmount` if amount is zero or negative
pub fn create_package(
    env: Env,
    recipient: Address,
    amount: i128,
    token: Address,
    expires_in: u64,
) -> Result<u64, Error> {
    // implementation
}
```

### Error Handling
Always use the custom `Error` enum for error cases:

```rust
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Error {
    NotAuthorized = 1,
    InvalidAmount = 2,
    PackageNotFound = 3,
    PackageAlreadyClaimed = 4,
    PackageExpired = 5,
}
```

### Testing Standards
```rust
#[test]
fn test_create_package() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    env.mock_all_auths();
    
    let package_id = client.create_package(&recipient, &1000, &token, &86400).unwrap();
    assert_eq!(package_id, 0);
    
    // Verify - get_package returns tuple: (recipient, amount, token, status, created_at, expires_at)
    let package = client.get_package(&package_id).unwrap().unwrap();
    assert_eq!(package.0, recipient);
    assert_eq!(package.1, 1000);
}