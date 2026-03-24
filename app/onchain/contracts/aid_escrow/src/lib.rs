#![no_std]

use soroban_sdk::{
    Address, Env, Map, String, Symbol, Vec, contract, contracterror, contractevent, contractimpl,
    contracttype, symbol_short, token,
};

// --- Storage Keys ---
const KEY_ADMIN: Symbol = symbol_short!("admin");
const KEY_TOTAL_LOCKED: Symbol = symbol_short!("locked");
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

// --- Contract Events ---
// Changed from #[contracttype] to #[contractevent]

#[contractevent]
pub struct FundEvent {
    pub from: Address,
    pub token: Address,
    pub amount: i128,
}

#[contractevent]
pub struct PackageCreatedEvent {
    pub id: u64,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ClaimedEvent {
    pub id: u64,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct DisbursedEvent {
    pub id: u64,
    pub admin: Address,
    pub amount: i128,
}

#[contractevent]
pub struct RevokedEvent {
    pub id: u64,
    pub admin: Address,
    pub amount: i128,
}

#[contractevent]
pub struct RefundedEvent {
    pub id: u64,
    pub admin: Address,
    pub amount: i128,
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

    /// Initialises the contract. Must be called exactly once before any other function.
    ///
    /// # Arguments
    /// * `admin` - The address that will own the contract and hold admin privileges.
    ///
    /// # Errors
    /// * [`Error::AlreadyInitialized`] – contract has already been initialised.
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&KEY_ADMIN) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&KEY_ADMIN, &admin);
        let config = Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
        };
        env.storage().instance().set(&KEY_CONFIG, &config);
        Ok(())
    }

    /// Returns the current admin address.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – contract has not been initialised yet.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(Error::NotInitialized)
    }

    /// Grants distributor privileges to `addr`, allowing it to call `create_package` and `batch_create_packages`.
    ///
    /// # Arguments
    /// * `addr` - Address to promote to distributor.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – contract not initialised.
    /// * [`Error::NotAuthorized`] – caller is not the admin.
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

    /// Revokes distributor privileges from `addr`.
    ///
    /// # Arguments
    /// * `addr` - Address to demote.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – contract not initialised.
    /// * [`Error::NotAuthorized`] – caller is not the admin.
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

    /// Updates the contract configuration.
    ///
    /// # Arguments
    /// * `config` - New [`Config`] value containing `min_amount`, `max_expires_in`, and `allowed_tokens`.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – contract not initialised.
    /// * [`Error::NotAuthorized`] – caller is not the admin.
    /// * [`Error::InvalidAmount`] – `config.min_amount` is ≤ 0.
    pub fn set_config(env: Env, config: Config) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        if config.min_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        env.storage().instance().set(&KEY_CONFIG, &config);
        Ok(())
    }

    /// Pauses the contract, blocking `create_package`, `batch_create_packages`, and `claim`.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – contract not initialised.
    /// * [`Error::NotAuthorized`] – caller is not the admin.
    pub fn pause(env: Env) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();
        env.storage().instance().set(&KEY_PAUSED, &true);
        ContractPausedEvent { admin }.publish(&env);
        Ok(())
    }

    /// Resumes normal contract operation after a pause.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – contract not initialised.
    /// * [`Error::NotAuthorized`] – caller is not the admin.
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

    /// Returns the current [`Config`]. Falls back to safe defaults if not yet set.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&KEY_CONFIG).unwrap_or(Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
        })
    }

    // --- Funding & Packages ---

    /// Deposits tokens into the contract pool so packages can be created against them.
    ///
    /// # Arguments
    /// * `token` - SEP-41 token contract address.
    /// * `from`  - Address funding the contract; must authorise this call.
    /// * `amount` - Amount to transfer (must be > 0).
    ///
    /// # Errors
    /// * [`Error::InvalidAmount`] – `amount` is ≤ 0.
    pub fn fund(env: Env, token: Address, from: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        from.require_auth();

        // Perform transfer: From -> Contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, env.current_contract_address(), &amount);

        // Emit event
        FundEvent {
            from,
            token,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Creates a single aid package and locks the specified funds for the recipient.
    ///
    /// The caller must be the admin or an authorised distributor. Funds are reserved
    /// from the contract's unallocated pool; the package cannot be created if the pool
    /// has insufficient balance.
    ///
    /// # Arguments
    /// * `operator`   - Admin or distributor address; must authorise this call.
    /// * `id`         - Caller-supplied unique package identifier.
    /// * `recipient`  - Address that may claim the package.
    /// * `amount`     - Token amount to lock (must be ≥ `config.min_amount`).
    /// * `token`      - SEP-41 token contract address.
    /// * `expires_at` - Unix timestamp after which the package expires (`0` = no expiry).
    ///
    /// # Errors
    /// * [`Error::ContractPaused`]    – contract is paused.
    /// * [`Error::NotAuthorized`]     – `operator` is neither admin nor distributor.
    /// * [`Error::InvalidAmount`]     – `amount` ≤ 0 or below `min_amount`.
    /// * [`Error::InvalidState`]      – token not in `allowed_tokens`, or expiry violates `max_expires_in`.
    /// * [`Error::PackageIdExists`]   – a package with `id` already exists.
    /// * [`Error::InsufficientFunds`] – contract pool cannot cover the new package.
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

        // 5. Track package index for aggregation
        let idx: u64 = env.storage().instance().get(&KEY_PKG_IDX).unwrap_or(0);
        let idx_key = (symbol_short!("pidx"), idx);
        env.storage().persistent().set(&idx_key, &id);
        env.storage().instance().set(&KEY_PKG_IDX, &(idx + 1));

        // Emit Event
        PackageCreatedEvent {
            id,
            recipient,
            amount,
        }
        .publish(&env);

        Ok(id)
    }

    /// Creates multiple aid packages in a single transaction using auto-incremented IDs.
    ///
    /// Package IDs are assigned sequentially from the internal counter. Each package
    /// shares the same `token` and expiry window (`expires_in` seconds from now).
    ///
    /// # Arguments
    /// * `operator`   - Admin or distributor address; must authorise this call.
    /// * `recipients` - Ordered list of recipient addresses.
    /// * `amounts`    - Ordered list of amounts, one per recipient (must be > 0 each).
    /// * `token`      - SEP-41 token contract address.
    /// * `expires_in` - Seconds from the current ledger timestamp until expiry.
    ///
    /// # Errors
    /// * [`Error::ContractPaused`]    – contract is paused.
    /// * [`Error::NotAuthorized`]     – `operator` is neither admin nor distributor.
    /// * [`Error::MismatchedArrays`]  – `recipients` and `amounts` have different lengths.
    /// * [`Error::InvalidAmount`]     – any individual amount is ≤ 0.
    /// * [`Error::InsufficientFunds`] – contract pool cannot cover all packages.
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

            // Emit per-package event
            PackageCreatedEvent {
                id,
                recipient,
                amount,
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

    /// Allows the designated recipient to claim their aid package.
    ///
    /// The recipient must authorise this call. On success the package status transitions
    /// to `Claimed`, the locked funds are released, and the token amount is transferred
    /// directly to the recipient.
    ///
    /// # Arguments
    /// * `id` - Package identifier to claim.
    ///
    /// # Errors
    /// * [`Error::ContractPaused`]   – contract is paused.
    /// * [`Error::PackageNotFound`]  – no package exists with `id`.
    /// * [`Error::PackageNotActive`] – package is not in `Created` status.
    /// * [`Error::PackageExpired`]   – package has passed its `expires_at` timestamp.
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

        // Emit Event
        ClaimedEvent {
            id,
            recipient: package.recipient.clone(),
            amount: package.amount,
        }
        .publish(&env);

        Ok(())
    }

    // --- Admin Actions ---

    /// Admin-initiated disbursement — pushes funds to the recipient without requiring their signature.
    ///
    /// Useful when the recipient cannot sign (e.g. field operations). Transitions the package
    /// to `Claimed` and transfers funds to the recipient address on record.
    ///
    /// # Arguments
    /// * `id` - Package identifier to disburse.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]   – contract not initialised.
    /// * [`Error::NotAuthorized`]    – caller is not the admin.
    /// * [`Error::PackageNotFound`]  – no package exists with `id`.
    /// * [`Error::PackageNotActive`] – package is not in `Created` status.
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

        DisbursedEvent {
            id,
            admin: admin.clone(),
            amount: package.amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Cancels a `Created` package and returns its locked funds to the pool.
    ///
    /// Unlike `cancel_package`, this does not check whether the package has expired,
    /// making it suitable for administrative clean-up of any active package.
    ///
    /// # Arguments
    /// * `id` - Package identifier to revoke.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]  – contract not initialised.
    /// * [`Error::NotAuthorized`]   – caller is not the admin.
    /// * [`Error::PackageNotFound`] – no package exists with `id`.
    /// * [`Error::InvalidState`]    – package is not in `Created` status.
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

        RevokedEvent {
            id,
            admin: admin.clone(),
            amount: package.amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Transfers a package's tokens back to the admin after the package is `Expired` or `Cancelled`.
    ///
    /// If the package is still in `Created` status but its `expires_at` has passed, this
    /// function will auto-transition it to `Expired` before processing the refund.
    ///
    /// # Arguments
    /// * `id` - Package identifier to refund.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]  – contract not initialised.
    /// * [`Error::NotAuthorized`]   – caller is not the admin.
    /// * [`Error::PackageNotFound`] – no package exists with `id`.
    /// * [`Error::InvalidState`]    – package is `Claimed`, already `Refunded`, or `Created` but not yet expired.
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

        RefundedEvent {
            id,
            admin: admin.clone(),
            amount: package.amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Cancels a `Created` package that has not yet expired, returning funds to the pool.
    ///
    /// # Arguments
    /// * `package_id` - Package identifier to cancel.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]   – contract not initialised.
    /// * [`Error::NotAuthorized`]    – caller is not the admin.
    /// * [`Error::PackageNotFound`]  – no package exists with `package_id`.
    /// * [`Error::PackageNotActive`] – package is not in `Created` status.
    /// * [`Error::PackageExpired`]   – package has already passed its `expires_at` timestamp.
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

        // Reuse RevokedEvent or create a new CancelledEvent if preferred
        RevokedEvent {
            id: package_id,
            admin,
            amount: package.amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Extends the expiry of a `Created` package by `additional_time` seconds.
    ///
    /// Cannot be used on unbounded packages (`expires_at == 0`). The resulting
    /// `expires_at` must still satisfy `config.max_expires_in` if that limit is set.
    ///
    /// # Arguments
    /// * `package_id`      - Package identifier to extend.
    /// * `additional_time` - Seconds to add to the current `expires_at` (must be > 0).
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]   – contract not initialised.
    /// * [`Error::NotAuthorized`]    – caller is not the admin.
    /// * [`Error::PackageNotFound`]  – no package exists with `package_id`.
    /// * [`Error::PackageNotActive`] – package is not in `Created` status.
    /// * [`Error::InvalidAmount`]    – `additional_time` is 0.
    /// * [`Error::InvalidState`]     – package is unbounded or new expiry violates `max_expires_in`.
    /// * [`Error::PackageExpired`]   – package has already expired.
    pub fn extend_expiration(env: Env, package_id: u64, additional_time: u64) -> Result<(), Error> {
        // 1. Only the admin can extend (check stored admin and require_auth)
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();
        let config = Self::get_config(env.clone());

        // 2. Package must exist
        let key = (symbol_short!("pkg"), package_id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        // 3. Package status must be Created
        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        // 4. additional_time must be greater than 0
        if additional_time == 0 {
            return Err(Error::InvalidAmount);
        }

        // 5. Package must not be unbounded (expires_at must be > 0)
        if package.expires_at == 0 {
            return Err(Error::InvalidState);
        }

        // 6. Package must not already be expired
        if env.ledger().timestamp() > package.expires_at {
            return Err(Error::PackageExpired);
        }

        // 7. Calculate new expiration and update
        let old_expires_at = package.expires_at;
        let new_expires_at = old_expires_at + additional_time;
        if config.max_expires_in > 0 {
            let now = env.ledger().timestamp();
            if new_expires_at <= now || new_expires_at - now > config.max_expires_in {
                return Err(Error::InvalidState);
            }
        }
        package.expires_at = new_expires_at;
        env.storage().persistent().set(&key, &package);

        // 8. Emit Extended event
        ExtendedEvent {
            id: package_id,
            admin: admin.clone(),
            old_expires_at,
            new_expires_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Withdraws surplus (unallocated) tokens from the contract to `to`.
    ///
    /// Surplus = contract token balance − total locked amount. Only tokens not
    /// committed to any active package may be withdrawn.
    ///
    /// # Arguments
    /// * `to`     - Destination address for the withdrawn tokens.
    /// * `amount` - Amount to withdraw (must be > 0).
    /// * `token`  - SEP-41 token contract address.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]      – contract not initialised.
    /// * [`Error::NotAuthorized`]       – caller is not the admin.
    /// * [`Error::InvalidAmount`]       – `amount` is ≤ 0.
    /// * [`Error::InsufficientSurplus`] – requested amount exceeds available surplus.
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

    /// Returns the full [`Package`] struct for the given ID.
    ///
    /// # Arguments
    /// * `id` - Package identifier to look up.
    ///
    /// # Errors
    /// * [`Error::PackageNotFound`] – no package exists with `id`.
    pub fn get_package(env: Env, id: u64) -> Result<Package, Error> {
        let key = (symbol_short!("pkg"), id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)
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
                if let Some(package) = env.storage().persistent().get::<_, Package>(&pkg_key)
                    && package.token == token
                {
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

        Aggregates {
            total_committed,
            total_claimed,
            total_expired_cancelled,
        }
    }
}
