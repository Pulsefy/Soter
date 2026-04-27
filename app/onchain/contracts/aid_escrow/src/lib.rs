#![no_std]

extern crate alloc;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token,
    Address, Env, Map, String, Symbol, Vec,
};

// --- Storage Keys ---
const KEY_ADMIN: Symbol = symbol_short!("admin");
const KEY_TOTAL_LOCKED: Symbol = symbol_short!("locked"); // Map<Address, i128>
const KEY_VERSION: Symbol = symbol_short!("version");
const KEY_PKG_COUNTER: Symbol = symbol_short!("pkg_cnt");
const KEY_CONFIG: Symbol = symbol_short!("config");
const KEY_PKG_IDX: Symbol = symbol_short!("pkg_idx"); // Aggregation index counter
const KEY_DISTRIBUTORS: Symbol = symbol_short!("dstrbtrs"); // Map<Address, bool>
const KEY_PAUSED: Symbol = symbol_short!("paused");

// --- Data Types ---

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum PackageStatus {
    Created = 0,
    Claimed = 1,
    Expired = 2,
    Cancelled = 3,
    Refunded = 4,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub min_amount: i128,
    pub max_expires_in: u64,
    pub allowed_tokens: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Aggregates {
    pub total_committed: i128,
    pub total_claimed: i128,
    pub total_expired_cancelled: i128,
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    InvalidAmount = 4,
    PackageNotFound = 5,
    PackageNotActive = 6,
    PackageExpired = 7,
    PackageNotExpired = 8,
    InsufficientFunds = 9,
    PackageIdExists = 10,
    InvalidState = 11,
    // recipients and amounts have different lengths
    MismatchedArrays = 12,
    InsufficientSurplus = 13,
    ContractPaused = 14,
}

// --- Contract Events (indexer-friendly; stable topics & payloads) ---
// Topic = struct name in snake_case (e.g. package_created). Do not rename without versioning.

/// Emitted when the escrow pool is funded. Actor = funder.
#[contractevent]
pub struct EscrowFunded {
    pub from: Address,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
}

/// Emitted when a package is created. Actor = operator (admin or distributor).
#[contractevent]
pub struct PackageCreated {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when a recipient claims a package. Actor = recipient.
#[contractevent]
pub struct PackageClaimed {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when admin disburses a package. Actor = admin.
#[contractevent]
pub struct PackageDisbursed {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when a package is revoked/cancelled. Actor = admin.
#[contractevent]
pub struct PackageRevoked {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when funds are refunded to admin after expire/cancel. Actor = admin.
#[contractevent]
pub struct PackageRefunded {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent]
pub struct BatchCreatedEvent {
    pub ids: Vec<u64>,
    pub admin: Address,
    pub total_amount: i128,
}

#[contractevent]
pub struct ExtendedEvent {
    pub id: u64,
    pub admin: Address,
    pub old_expires_at: u64,
    pub new_expires_at: u64,
}

#[contractevent]
pub struct SurplusWithdrawnEvent {
    pub to: Address,
    pub token: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ContractPausedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct ContractUnpausedEvent {
    pub admin: Address,
}

#[contract]
pub struct AidEscrow;

#[contractimpl]
impl AidEscrow {
    // --- Admin & Config ---

    /// Initializes the contract.
    ///
    /// # Arguments
    /// * `admin` — The address that will own the contract (can pause, config, disburse, etc.).
    ///
    /// # Errors
    /// Returns `Error::AlreadyInitialized` if called more than once.
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&KEY_ADMIN) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_VERSION, &1u32);
        let config = Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
        };
        env.storage().instance().set(&KEY_CONFIG, &config);
        Ok(())
    }

    /// Returns the admin address stored at initialization.
    ///
    /// # Errors
    /// Returns `Error::NotInitialized` if the contract has not been initialized.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(Error::NotInitialized)
    }

    /// Returns the current contract version.
    /// Defaults to `0` if the contract has never been initialized.
    pub fn get_version(env: Env) -> u32 {
        env.storage().instance().get(&KEY_VERSION).unwrap_or(0)
    }

    /// Admin-only. Bumps the contract version and runs any required migration logic.
    ///
    /// # Arguments
    /// * `new_version` — Target version number.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn migrate(env: Env, new_version: u32) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let current_version = Self::get_version(env.clone());

        // Perform version-specific migrations
        match (current_version, new_version) {
            (1, 2) => {
                // Future: Add migration logic for v1 -> v2
            }
            _ => {
                // No-op for now, but structured for future use
            }
        }

        env.storage().instance().set(&KEY_VERSION, &new_version);
        Ok(())
    }

    /// Admin-only. Grants distributor privileges to `addr`.
    /// Distributors can create packages but cannot pause, config, or disburse.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn add_distributor(env: Env, addr: Address) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let mut distributors: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&KEY_DISTRIBUTORS)
            .unwrap_or(Map::new(&env));
        distributors.set(addr, true);
        env.storage()
            .instance()
            .set(&KEY_DISTRIBUTORS, &distributors);

        Ok(())
    }

    /// Admin-only. Revokes distributor privileges from `addr`.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn remove_distributor(env: Env, addr: Address) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let mut distributors: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&KEY_DISTRIBUTORS)
            .unwrap_or(Map::new(&env));
        distributors.remove(addr);
        env.storage()
            .instance()
            .set(&KEY_DISTRIBUTORS, &distributors);

        Ok(())
    }

    /// Admin-only. Updates the global contract configuration.
    ///
    /// # Arguments
    /// * `config` — New config values (`min_amount`, `max_expires_in`, `allowed_tokens`).
    ///
    /// # Errors
    /// Returns `Error::InvalidAmount` if `config.min_amount` is zero or negative.
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn set_config(env: Env, config: Config) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        if config.min_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        env.storage().instance().set(&KEY_CONFIG, &config);
        Ok(())
    }

    /// Admin-only. Pauses the contract.
    /// While paused, package creation and claims are blocked.
    /// Emits a `ContractPausedEvent`.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn pause(env: Env) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();
        env.storage().instance().set(&KEY_PAUSED, &true);
        ContractPausedEvent { admin }.publish(&env);
        Ok(())
    }

    /// Admin-only. Unpauses the contract, resuming normal operation.
    /// Emits a `ContractUnpausedEvent`.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();
        env.storage().instance().set(&KEY_PAUSED, &false);
        ContractUnpausedEvent { admin }.publish(&env);
        Ok(())
    }

    /// Returns `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&KEY_PAUSED).unwrap_or(false)
    }

    /// Returns the current contract configuration.
    /// Falls back to defaults (`min_amount: 1`, `max_expires_in: 0`, empty token list)
    /// if no config has been explicitly set.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&KEY_CONFIG).unwrap_or(Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
        })
    }

    // --- Funding & Packages ---

    /// Funds the contract (Pool Model).
    /// Transfers `amount` of `token` from `from` to this contract.
    /// This increases the contract's balance, allowing new packages to be created.
    pub fn fund(env: Env, token: Address, from: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        from.require_auth();

        // Perform transfer: From -> Contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, env.current_contract_address(), &amount);

        let timestamp = env.ledger().timestamp();
        EscrowFunded {
            from,
            token,
            amount,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Creates a package with a specific ID.
    /// Locks funds from the available pool (Contract Balance - Total Locked).
    pub fn create_package(
        env: Env,
        operator: Address,
        id: u64,
        recipient: Address,
        amount: i128,
        token: Address,
        expires_at: u64,
    ) -> Result<u64, Error> {
        Self::check_paused(&env)?;
        Self::require_admin_or_distributor(&env, &operator)?;
        let config = Self::get_config(env.clone());

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        if amount < config.min_amount {
            return Err(Error::InvalidAmount);
        }

        if !config.allowed_tokens.is_empty() && !config.allowed_tokens.contains(token.clone()) {
            return Err(Error::InvalidState);
        }

        if config.max_expires_in > 0 {
            let now = env.ledger().timestamp();
            if expires_at == 0 || expires_at <= now || expires_at - now > config.max_expires_in {
                return Err(Error::InvalidState);
            }
        }

        // 1. Check ID Uniqueness
        let key = (symbol_short!("pkg"), id);
        if env.storage().persistent().has(&key) {
            return Err(Error::PackageIdExists);
        }

        // 2. Check Solvency (Available Balance vs Locked)
        let token_client = token::Client::new(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());

        let mut locked_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_LOCKED)
            .unwrap_or(Map::new(&env));
        let current_locked = locked_map.get(token.clone()).unwrap_or(0);

        // Ensure we don't over-promise funds
        if contract_balance < current_locked + amount {
            return Err(Error::InsufficientFunds);
        }

        // 3. Update Locked State
        locked_map.set(token.clone(), current_locked + amount);
        env.storage().instance().set(&KEY_TOTAL_LOCKED, &locked_map);

        // 4. Create Package
        let created_at = env.ledger().timestamp();
        let package = Package {
            id,
            recipient: recipient.clone(),
            amount,
            token: token.clone(),
            status: PackageStatus::Created,
            created_at,
            expires_at,
            metadata: Map::new(&env),
        };

        env.storage().persistent().set(&key, &package);

        let counter: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        if id >= counter {
            env.storage().instance().set(&KEY_PKG_COUNTER, &(id + 1));
        }

        // 5. Track package index for aggregation
        let idx: u64 = env.storage().instance().get(&KEY_PKG_IDX).unwrap_or(0);
        let idx_key = (symbol_short!("pidx"), idx);
        env.storage().persistent().set(&idx_key, &id);
        env.storage().instance().set(&KEY_PKG_IDX, &(idx + 1));

        PackageCreated {
            package_id: id,
            recipient: recipient.clone(),
            amount,
            actor: operator,
            timestamp: created_at,
        }
        .publish(&env);

        Ok(id)
    }

    /// Creates multiple packages in a single transaction for multiple recipients.
    /// Uses an auto-incrementing counter for package IDs.
    pub fn batch_create_packages(
        env: Env,
        operator: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
        token: Address,
        expires_in: u64,
    ) -> Result<Vec<u64>, Error> {
        Self::check_paused(&env)?;
        Self::require_admin_or_distributor(&env, &operator)?;

        // Validate array lengths match
        if recipients.len() != amounts.len() {
            return Err(Error::MismatchedArrays);
        }

        let token_client = token::Client::new(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());

        let mut locked_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_LOCKED)
            .unwrap_or(Map::new(&env));
        let mut current_locked = locked_map.get(token.clone()).unwrap_or(0);

        // Read the current package counter
        let mut counter: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        // Read the current aggregation index
        let mut idx: u64 = env.storage().instance().get(&KEY_PKG_IDX).unwrap_or(0);

        let created_at = env.ledger().timestamp();
        let expires_at = created_at + expires_in;

        let mut created_ids: Vec<u64> = Vec::new(&env);
        let mut total_amount: i128 = 0;

        for i in 0..recipients.len() {
            let recipient = recipients.get(i).unwrap();
            let amount = amounts.get(i).unwrap();

            // Validate amount
            if amount <= 0 {
                return Err(Error::InvalidAmount);
            }

            // Check solvency
            if contract_balance < current_locked + amount {
                return Err(Error::InsufficientFunds);
            }

            // Assign ID and increment counter
            let id = counter;
            counter += 1;

            let key = (symbol_short!("pkg"), id);

            // Create package
            let package = Package {
                id,
                recipient: recipient.clone(),
                amount,
                token: token.clone(),
                status: PackageStatus::Created,
                created_at,
                expires_at,
                metadata: Map::new(&env),
            };

            env.storage().persistent().set(&key, &package);

            // Track package index for aggregation
            let idx_key = (symbol_short!("pidx"), idx);
            env.storage().persistent().set(&idx_key, &id);
            idx += 1;

            // Update locked
            current_locked += amount;
            total_amount += amount;

            PackageCreated {
                package_id: id,
                recipient: recipient.clone(),
                amount,
                actor: operator.clone(),
                timestamp: created_at,
            }
            .publish(&env);

            created_ids.push_back(id);
        }

        // Persist updated locked map, counter, and aggregation index
        locked_map.set(token.clone(), current_locked);
        env.storage().instance().set(&KEY_TOTAL_LOCKED, &locked_map);
        env.storage().instance().set(&KEY_PKG_COUNTER, &counter);
        env.storage().instance().set(&KEY_PKG_IDX, &idx);

        // Emit batch event
        BatchCreatedEvent {
            ids: created_ids.clone(),
            admin: operator,
            total_amount,
        }
        .publish(&env);

        Ok(created_ids)
    }

    // --- Recipient Actions ---

    /// Recipient claims the package.
    pub fn claim(env: Env, id: u64) -> Result<(), Error> {
        Self::check_paused(&env)?;
        let key = (symbol_short!("pkg"), id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        // Validations
        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }
        // Check expiry
        if package.expires_at > 0 && env.ledger().timestamp() > package.expires_at {
            // Auto-expire if accessed after date
            package.status = PackageStatus::Expired;
            env.storage().persistent().set(&key, &package);
            return Err(Error::PackageExpired);
        }

        // Auth
        package.recipient.require_auth();

        // State Transition: Created -> Claimed
        // Checks passed, update state FIRST (Re-entrancy protection)
        package.status = PackageStatus::Claimed;
        env.storage().persistent().set(&key, &package);

        // Update Global Locked
        Self::decrement_locked(&env, &package.token, package.amount);

        // Effect: Transfer Funds
        let token_client = token::Client::new(&env, &package.token);
        token_client.transfer(
            &env.current_contract_address(),
            &package.recipient,
            &package.amount,
        );

        let timestamp = env.ledger().timestamp();
        PackageClaimed {
            package_id: id,
            recipient: package.recipient.clone(),
            amount: package.amount,
            actor: package.recipient.clone(),
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    // --- Admin Actions ---

    /// Admin manually triggers disbursement (overrides recipient claim need, strictly checks status).
    pub fn disburse(env: Env, id: u64) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = (symbol_short!("pkg"), id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        // State Transition
        package.status = PackageStatus::Claimed;
        env.storage().persistent().set(&key, &package);

        // Update Locked
        Self::decrement_locked(&env, &package.token, package.amount);

        // Transfer
        let token_client = token::Client::new(&env, &package.token);
        token_client.transfer(
            &env.current_contract_address(),
            &package.recipient,
            &package.amount,
        );

        let timestamp = env.ledger().timestamp();
        PackageDisbursed {
            package_id: id,
            recipient: package.recipient.clone(),
            amount: package.amount,
            actor: admin.clone(),
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin revokes a package (Cancels it). Funds are effectively unlocked but remain in contract pool.
    pub fn revoke(env: Env, id: u64) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = (symbol_short!("pkg"), id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        if package.status != PackageStatus::Created {
            return Err(Error::InvalidState);
        }

        // State Transition
        package.status = PackageStatus::Cancelled;
        env.storage().persistent().set(&key, &package);

        // Unlock funds (return to pool)
        Self::decrement_locked(&env, &package.token, package.amount);

        let timestamp = env.ledger().timestamp();
        PackageRevoked {
            package_id: id,
            recipient: package.recipient.clone(),
            amount: package.amount,
            actor: admin.clone(),
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    pub fn refund(env: Env, id: u64) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = (symbol_short!("pkg"), id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        // Can only refund if Expired or Cancelled.
        // If Created, must Revoke first. If Claimed, impossible.
        // If Refunded, impossible.
        if package.status == PackageStatus::Created {
            // Check if actually expired
            if package.expires_at > 0 && env.ledger().timestamp() > package.expires_at {
                package.status = PackageStatus::Expired;
                // If we just expired it, we need to unlock the funds first
                Self::decrement_locked(&env, &package.token, package.amount);
            } else {
                return Err(Error::InvalidState);
            }
        } else if package.status == PackageStatus::Claimed
            || package.status == PackageStatus::Refunded
        {
            return Err(Error::InvalidState);
        }

        // If Cancelled, funds were already unlocked in `revoke`.
        // If Expired (logic above), funds were just unlocked.

        // State Transition
        package.status = PackageStatus::Refunded;
        env.storage().persistent().set(&key, &package);

        // Transfer Contract -> Admin
        let token_client = token::Client::new(&env, &package.token);
        token_client.transfer(&env.current_contract_address(), &admin, &package.amount);

        let timestamp = env.ledger().timestamp();
        PackageRefunded {
            package_id: id,
            recipient: package.recipient.clone(),
            amount: package.amount,
            actor: admin.clone(),
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only package cancellation.
    /// Requirements: Admin auth, existing package, status must be 'Created'.
    pub fn cancel_package(env: Env, package_id: u64) -> Result<(), Error> {
        // 1. Only the admin can cancel (check stored admin and require_auth)
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        // 2. Package must exist
        let key = (symbol_short!("pkg"), package_id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        // 3. Package status must be Created (not Claimed, Expired, or already Cancelled)
        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        // Additional check: Ensure it hasn't expired yet (consistent with 'claim' logic)
        if package.expires_at > 0 && env.ledger().timestamp() > package.expires_at {
            return Err(Error::PackageExpired);
        }

        // 4. Update status to Cancelled and persist
        package.status = PackageStatus::Cancelled;
        env.storage().persistent().set(&key, &package);

        // 5. Unlock funds (Decrement the global locked amount so funds return to the pool)
        Self::decrement_locked(&env, &package.token, package.amount);

        let timestamp = env.ledger().timestamp();
        PackageRevoked {
            package_id,
            recipient: package.recipient.clone(),
            amount: package.amount,
            actor: admin.clone(),
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only package expiration extension.
    /// Requirements: Admin auth, existing package, status must be 'Created', additional_time > 0.
    /// Behavior: Adds additional_time to the package's expires_at timestamp.
    /// Cannot extend unbounded packages (expires_at == 0).
    pub fn extend_expiration(env: Env, package_id: u64, additional_time: u64) -> Result<(), Error> {
        if additional_time == 0 {
            return Err(Error::InvalidAmount);
        }

        let package = Self::get_package(env.clone(), package_id)?;
        if package.expires_at == 0 {
            return Err(Error::InvalidState);
        }

        Self::extend_expiry(env, package_id, package.expires_at + additional_time)
    }

    /// Admin-only package expiration extension using an absolute target timestamp.
    /// Requirements: admin auth, existing package, package still active, and `new_expires_at`
    /// must strictly increase the current expiry while respecting config safety limits.
    pub fn extend_expiry(env: Env, id: u64, new_expires_at: u64) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();
        let config = Self::get_config(env.clone());

        let key = (symbol_short!("pkg"), id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        if package.expires_at == 0 {
            return Err(Error::InvalidState);
        }

        let now = env.ledger().timestamp();
        if now > package.expires_at {
            return Err(Error::PackageExpired);
        }

        let old_expires_at = package.expires_at;
        if new_expires_at <= old_expires_at {
            return Err(Error::InvalidState);
        }

        if config.max_expires_in > 0
            && (new_expires_at <= now || new_expires_at - now > config.max_expires_in)
        {
            return Err(Error::InvalidState);
        }

        package.expires_at = new_expires_at;
        env.storage().persistent().set(&key, &package);

        ExtendedEvent {
            id,
            admin,
            old_expires_at,
            new_expires_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only function to withdraw surplus (unallocated) funds from the contract.
    /// Requirements: Admin auth, valid amount, sufficient surplus available.
    /// Behavior: Transfers amount of token from contract to the specified address.
    pub fn withdraw_surplus(
        env: Env,
        to: Address,
        amount: i128,
        token: Address,
    ) -> Result<(), Error> {
        // 1. Only the admin can withdraw surplus
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        // 2. Validate amount
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // 3. Get contract's current balance for the token
        let token_client = token::Client::new(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());

        // 4. Get total locked amount for the token
        let locked_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_LOCKED)
            .unwrap_or(Map::new(&env));
        let total_locked = locked_map.get(token.clone()).unwrap_or(0);

        // 5. Calculate available surplus and validate
        let available_surplus = contract_balance - total_locked;
        if amount > available_surplus {
            return Err(Error::InsufficientSurplus);
        }

        // 6. Transfer funds from contract to recipient
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        // 7. Emit event
        SurplusWithdrawnEvent {
            to: to.clone(),
            token: token.clone(),
            amount,
        }
        .publish(&env);

        Ok(())
    }

    // --- Helpers ---

    fn check_paused(env: &Env) -> Result<(), Error> {
        if env.storage().instance().get(&KEY_PAUSED).unwrap_or(false) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn decrement_locked(env: &Env, token: &Address, amount: i128) {
        let mut locked_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_LOCKED)
            .unwrap_or(Map::new(env));

        let current = locked_map.get(token.clone()).unwrap_or(0);
        let new_locked = if current > amount {
            current - amount
        } else {
            0
        };

        locked_map.set(token.clone(), new_locked);
        env.storage().instance().set(&KEY_TOTAL_LOCKED, &locked_map);
    }

    fn require_admin_or_distributor(env: &Env, operator: &Address) -> Result<(), Error> {
        operator.require_auth();

        let admin = Self::get_admin(env.clone())?;
        if *operator == admin {
            return Ok(());
        }

        let distributors: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&KEY_DISTRIBUTORS)
            .unwrap_or(Map::new(env));
        if distributors.get(operator.clone()).unwrap_or(false) {
            Ok(())
        } else {
            Err(Error::NotAuthorized)
        }
    }

    /// Retrieves the full details of a package by its ID.
    ///
    /// # Errors
    /// Returns `Error::PackageNotFound` if no package exists with the given `id`.
    pub fn get_package(env: Env, id: u64) -> Result<Package, Error> {
        let key = (symbol_short!("pkg"), id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)
    }

    /// Returns only the status of a package.
    /// Cheaper alternative to get_package for polling frontends.
    pub fn view_package_status(env: Env, id: u64) -> Result<PackageStatus, Error> {
        let pkg = Self::get_package(env, id)?;
        Ok(pkg.status)
    }

    // --- Analytics ---

    /// Returns aggregate statistics for a given token.
    ///
    /// Iterates across all created packages and computes:
    /// - `total_committed`: sum of amounts for packages still in `Created` status,
    /// - `total_claimed`: sum of amounts for packages in `Claimed` status,
    /// - `total_expired_cancelled`: sum of amounts for packages in `Expired`,
    ///    `Cancelled`, or `Refunded` status.
    ///
    /// This is a read-only view intended for dashboards and analytics.
    pub fn get_aggregates(env: Env, token: Address) -> Aggregates {
        let count: u64 = env.storage().instance().get(&KEY_PKG_IDX).unwrap_or(0);

        let mut total_committed: i128 = 0;
        let mut total_claimed: i128 = 0;
        let mut total_expired_cancelled: i128 = 0;

        for i in 0..count {
            let idx_key = (symbol_short!("pidx"), i);
            if let Some(pkg_id) = env.storage().persistent().get::<_, u64>(&idx_key) {
                let pkg_key = (symbol_short!("pkg"), pkg_id);
                if let Some(package) = env.storage().persistent().get::<_, Package>(&pkg_key) {
                    if package.token == token {
                        match package.status {
                            PackageStatus::Created => {
                                total_committed += package.amount;
                            }
                            PackageStatus::Claimed => {
                                total_claimed += package.amount;
                            }
                            PackageStatus::Expired
                            | PackageStatus::Cancelled
                            | PackageStatus::Refunded => {
                                total_expired_cancelled += package.amount;
                            }
                        }
                    }
                }
            }
        }

        Aggregates {
            total_committed,
            total_claimed,
            total_expired_cancelled,
        }
    }

    /// Returns the number of stored packages assigned to `recipient`.
    ///
    /// This naive helper scans all package IDs from `0..package_counter`, treating the
    /// counter as an upper bound over assigned IDs and skipping gaps.
    pub fn get_recipient_package_count(env: Env, recipient: Address) -> u64 {
        let count: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        let mut matches = 0;

        for id in 0..count {
            let key = (symbol_short!("pkg"), id);
            if let Some(package) = env.storage().persistent().get::<_, Package>(&key) {
                if package.recipient == recipient {
                    matches += 1;
                }
            }
        }

        matches
    }

    /// Lists package IDs for a specific recipient with pagination.
    ///
    /// # Arguments
    /// * `recipient` - The address to filter packages by
    /// * `cursor` - Starting position for pagination (0-indexed)
    /// * `limit` - Maximum number of results to return
    ///
    /// # Returns
    /// A Vec<u64> containing package IDs that belong to the recipient,
    /// starting from the cursor position and limited by the limit parameter.
    pub fn list_recipient_packages(
        env: Env,
        recipient: Address,
        cursor: u64,
        limit: u32,
    ) -> Vec<u64> {
        let package_counter: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        let mut result: Vec<u64> = Vec::new(&env);

        // Calculate the end position: cursor + limit or package_counter, whichever comes first
        let end_pos = if cursor.saturating_add(limit as u64) > package_counter {
            package_counter
        } else {
            cursor.saturating_add(limit as u64)
        };

        // Iterate from cursor to end_pos
        for id in cursor..end_pos {
            let key = (symbol_short!("pkg"), id);
            if let Some(package) = env.storage().persistent().get::<_, Package>(&key) {
                if package.recipient == recipient {
                    result.push_back(id);
                }
            }
        }

        result
    }
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::{StellarAssetClient, TokenClient};
    use soroban_sdk::Env;

    fn setup() -> (Env, AidEscrowClient<'static>) {
        let env = Env::default();
        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        (env, client)
    }

    #[test]
    fn test_cancel_package() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);

        // Deploy a mock Stellar asset contract to use as the token.
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let sac = StellarAssetClient::new(&env, &token);
        let token_client = TokenClient::new(&env, &token);

        env.mock_all_auths();

        // Initialise the escrow contract.
        client.init(&admin);

        // Mint 10_000 tokens to admin and fund the escrow pool.
        sac.mint(&admin, &10_000);
        client.fund(&token, &admin, &5_000);

        // Confirm the contract holds the funded balance.
        assert_eq!(token_client.balance(&client.address), 5_000);

        let operator = admin.clone();
        let package_id = client.create_package(&operator, &1, &recipient, &1000, &token, &86400);
        client.cancel_package(&package_id);

        let package = client.get_package(&package_id);
        assert_eq!(package.status, PackageStatus::Cancelled);
    }

    #[test]
    fn test_list_recipient_packages_few_packages() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);

        // Deploy a mock Stellar asset contract to use as the token.
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let sac = StellarAssetClient::new(&env, &token);

        env.mock_all_auths();

        // Initialise the escrow contract.
        client.init(&admin);

        // Mint tokens to admin and fund the escrow pool.
        sac.mint(&admin, &10_000);
        client.fund(&token, &admin, &5_000);

        // Create packages for recipient1 (3 packages) and recipient2 (2 packages)
        let operator = admin.clone();
        let package1_id = client.create_package(&operator, &1, &recipient1, &1000, &token, &86400);
        let package2_id = client.create_package(&operator, &2, &recipient1, &1500, &token, &86400);
        let package3_id = client.create_package(&operator, &3, &recipient1, &2000, &token, &86400);
        let package4_id = client.create_package(&operator, &4, &recipient2, &1200, &token, &86400);
        let package5_id = client.create_package(&operator, &5, &recipient2, &1800, &token, &86400);

        // Test listing recipient1's packages with limit 10 (more than they have)
        let packages = client.list_recipient_packages(&recipient1, &0, &10);
        assert_eq!(packages.len(), 3);
        assert!(packages.contains(&package1_id));
        assert!(packages.contains(&package2_id));
        assert!(packages.contains(&package3_id));

        // Test listing recipient2's packages with limit 10 (more than they have)
        let packages = client.list_recipient_packages(&recipient2, &0, &10);
        assert_eq!(packages.len(), 2);
        assert!(packages.contains(&package4_id));
        assert!(packages.contains(&package5_id));
    }

    #[test]
    fn test_list_recipient_packages_pagination() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);

        // Deploy a mock Stellar asset contract to use as the token.
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let sac = StellarAssetClient::new(&env, &token);

        env.mock_all_auths();

        // Initialise the escrow contract.
        client.init(&admin);

        // Mint tokens to admin and fund the escrow pool.
        sac.mint(&admin, &20_000);
        client.fund(&token, &admin, &15_000);

        // Create 7 packages for the recipient
        let operator = admin.clone();
        let package_ids: alloc::vec::Vec<_> = (0..7)
            .map(|i| {
                client.create_package(
                    &operator,
                    &(i as u64),
                    &recipient,
                    &(1000 + i as i128 * 100),
                    &token,
                    &86400,
                )
            })
            .collect();

        // Test pagination with limit 3
        let page1 = client.list_recipient_packages(&recipient, &0, &3);
        assert_eq!(page1.len(), 3);
        assert!(page1.contains(&package_ids[0]));
        assert!(page1.contains(&package_ids[1]));
        assert!(page1.contains(&package_ids[2]));

        let page2 = client.list_recipient_packages(&recipient, &3, &3);
        assert_eq!(page2.len(), 3);
        assert!(page2.contains(&package_ids[3]));
        assert!(page2.contains(&package_ids[4]));
        assert!(page2.contains(&package_ids[5]));

        let page3 = client.list_recipient_packages(&recipient, &6, &3);
        assert_eq!(page3.len(), 1);
        assert!(page3.contains(&package_ids[6]));

        // Test cursor beyond available packages
        let empty_page = client.list_recipient_packages(&recipient, &10, &3);
        assert_eq!(empty_page.len(), 0);

        // Test limit that exceeds remaining packages
        let last_page = client.list_recipient_packages(&recipient, &5, &10);
        assert_eq!(last_page.len(), 2);
        assert!(last_page.contains(&package_ids[5]));
        assert!(last_page.contains(&package_ids[6]));
    }
}
