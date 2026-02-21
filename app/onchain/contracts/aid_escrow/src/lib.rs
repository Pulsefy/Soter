#![no_std]

use soroban_sdk::{
    Address, Env, Map, String, Symbol, contract, contracterror, contractevent, contractimpl,
    contracttype, symbol_short, token,
};

// --- Storage Keys ---
const KEY_ADMIN: Symbol = symbol_short!("admin");
const KEY_TOTAL_LOCKED: Symbol = symbol_short!("locked"); // Map<Address, i128>

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

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    InvalidAmount = 4,
    PackageNotFound = 5,
    PackageNotActive = 6, // Already claimed, expired, or cancelled
    PackageExpired = 7,
    PackageNotExpired = 8,
    InsufficientFunds = 9, // Contract balance < Total Locked + New Amount
    PackageIdExists = 10,
    InvalidState = 11, // Transition not allowed
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

#[contract]
pub struct AidEscrow;

#[contractimpl]
impl AidEscrow {
    // --- Admin & Config ---

    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&KEY_ADMIN) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&KEY_ADMIN, &admin);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(Error::NotInitialized)
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

        // Emit event
        FundEvent {
            from,
            token,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Creates a package with a specific ID.
    /// Locks funds from the available pool (Contract Balance - Total Locked).
    pub fn create_package(
        env: Env,
        id: u64,
        recipient: Address,
        amount: i128,
        token: Address,
        expires_at: u64,
    ) -> Result<u64, Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
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

        // Emit Event
        PackageCreatedEvent {
            id,
            recipient,
            amount,
        }
        .publish(&env);

        Ok(id)
    }

    // --- Recipient Actions ---

    /// Recipient claims the package.
    pub fn claim(env: Env, id: u64) -> Result<(), Error> {
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
        package.status = PackageStatus::Claimed; // Mark as claimed (or Disbursed if we had that enum)
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

        RevokedEvent {
            id,
            admin: admin.clone(),
            amount: package.amount,
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
                return Err(Error::InvalidState); // Must revoke first
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

        // Reuse RevokedEvent or create a new CancelledEvent if preferred
        RevokedEvent {
            id: package_id,
            admin,
            amount: package.amount,
        }
        .publish(&env);

        Ok(())
    }

    // --- Helpers ---

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

    pub fn get_package(env: Env, id: u64) -> Result<Package, Error> {
        let key = (symbol_short!("pkg"), id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)
    }
}
