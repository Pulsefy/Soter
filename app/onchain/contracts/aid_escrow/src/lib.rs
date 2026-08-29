#![no_std]

//! # Token Amount Normalization & Validation Policy
//!
//! ## Normalization Policy
//! All token amounts passed to this contract **must be normalized to the token's smallest unit** (e.g., stroops for Stellar, wei for Ethereum, or the lowest decimal unit for the token).
//! The contract does **not** perform automatic normalization or conversion based on token decimals. It is the caller's responsibility to ensure amounts are properly scaled.
//!
//! ## Validation Rules
//! - Amounts must be strictly positive integers (`amount > 0`).
//! - Amounts must be multiples of the token's smallest unit (i.e., no precision-breaking values).
//! - Zero, negative, or non-integer values (relative to the token's decimals) are rejected.
//! - The contract assumes all amounts are already validated and normalized before being passed in.
//!
//! ## Recommendations
//! - Integrators should fetch the token's decimals and normalize user input accordingly.
//! - When adding support for new tokens, ensure all amounts are compatible with the token's decimal convention.
//!
//! ## See Also
//! - Validation is enforced in `fund`, `create_package`, and related entrypoints.
//! - Tests for invalid/edge cases are in `tests/aid_escrow_tests.rs`.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, Address,
    Bytes, Env, IntoVal, Map, String, Symbol, Val, Vec,
};

mod delegate;
pub mod keys;
pub mod ttl;

// --- Storage Keys ---
// All storage keys are centralized in the `keys` module and re-exported
// below so existing call sites keep compiling unchanged. The canonical
// key-space reference lives in STORAGE_KEYS.md.
pub use crate::keys::{
    package_index_entry, package_key, KEY_ADMIN, KEY_CAMPAIGN_PAUSED, KEY_CONFIG, KEY_DELEGATES,
    KEY_DELEGATE_EXPIRY, KEY_DELEGATE_HISTORY, KEY_DISTRIBUTORS, KEY_PAUSED, KEY_PAUSE_CLAIM,
    KEY_PAUSE_CREATE, KEY_PAUSE_REFUND, KEY_PAUSE_WITHDRAW, KEY_PENDING_ADMIN, KEY_PKG_COUNTER,
    KEY_PKG_IDX, KEY_RECIPIENT_LAST_CLAIM, KEY_TOTAL_CLAIMED, KEY_TOTAL_LOCKED, KEY_VERSION,
};

/// Upper bound on the number of package ids accepted by `batch_claim` in a
/// single invocation, keeping the call within Soroban resource limits.
pub const MAX_BATCH_CLAIM_SIZE: u32 = 25;

/// Maximum number of package IDs that `list_recipient_packages` may return in
/// a single call.  Enforcing this keeps the response within Soroban's read-entry
/// resource budget even for recipients with large package histories.
pub const MAX_PAGE_SIZE: u32 = 50;

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
    pub claim_starts_at: u64,
    pub metadata: Map<Symbol, String>,
    pub evidence_hash: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub min_amount: i128,
    pub max_expires_in: u64,
    pub allowed_tokens: Vec<Address>,
    /// Minimum number of seconds a recipient must wait between successful
    /// claims. `0` disables the cooldown.
    pub claim_cooldown: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Aggregates {
    pub total_committed: i128,
    pub total_claimed: i128,
    pub total_expired_cancelled: i128,
}

/// Outcome of a single package claim attempt made as part of a `batch_claim`
/// call. `batch_claim` never fails a whole batch because one package could
/// not be claimed; instead each id resolves to one of these statuses.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum ClaimStatus {
    /// Package was claimed and the payout was transferred.
    Success = 0,
    /// No package exists with the given id.
    NotFound = 1,
    /// Package status is not `Created` (already claimed, cancelled, or refunded).
    NotActive = 2,
    /// Current ledger time is before the package's `claim_starts_at`.
    ClaimTooEarly = 3,
    /// Package has passed its `expires_at` timestamp.
    Expired = 4,
    /// Package is guarded by a Merkle allowlist; use `claim_with_proof` instead.
    RequiresProof = 5,
    /// Caller is neither the package's recipient nor an authorised delegate.
    Unauthorized = 6,
    /// The package's campaign is paused.
    CampaignPaused = 7,
    /// Eligibility checks passed but the token transfer failed.
    TransferFailed = 8,
    /// The recipient successfully claimed another package too recently.
    CooldownActive = 9,
}

/// Per-package result returned by `batch_claim`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchClaimResult {
    pub package_id: u64,
    pub status: ClaimStatus,
    /// Amount transferred to the claimant; zero unless `status` is `Success`.
    pub amount: i128,
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
    ClaimTooEarly = 15,
    InvalidProof = 16,
    InvalidToken = 17,
    TokenTransferFailed = 18,
    NoPendingTransfer = 19,
    InvalidPendingAdmin = 20,
    BatchTooLarge = 21,
    /// The recipient has not yet completed the configured claim cooldown.
    ClaimCooldownActive = 22,
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

#[contractevent]
pub struct PackageCreated {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent]
pub struct PackageReassigned {
    pub package_id: u64,
    pub previous_recipient: Address,
    pub new_recipient: Address,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent]
pub struct PackageClaimed {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
    /// Optional off-chain receipt hash for anchoring external records.
    /// Empty string when not provided.
    pub receipt_hash: String,
}

#[contractevent]
pub struct PackageClaimedByRelayer {
    pub package_id: u64,
    pub recipient: Address,
    pub relayer: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contractevent]
pub struct PackageDisbursed {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
    /// Optional off-chain receipt hash for anchoring external records.
    /// Empty string when not provided.
    pub receipt_hash: String,
}

#[contractevent]
pub struct PackageRevoked {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent]
pub struct PackageRefunded {
    pub package_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when the sweep transitions an expired package to the terminal
/// `Expired` state, releasing its funds from the locked total.
#[contractevent]
pub struct PackageSwept {
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
    pub package_id: u64,
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

#[contractevent]
pub struct ActionPausedEvent {
    pub admin: Address,
    pub action: Symbol,
}

#[contractevent]
pub struct ActionUnpausedEvent {
    pub admin: Address,
    pub action: Symbol,
}

/// Emitted when an admin pauses a single campaign, identified by the
/// `campaign_ref` metadata value shared by its packages.
#[contractevent]
pub struct CampaignPausedEvent {
    pub admin: Address,
    pub campaign_ref: String,
}

/// Emitted when an admin unpauses a single campaign.
#[contractevent]
pub struct CampaignUnpausedEvent {
    pub admin: Address,
    pub campaign_ref: String,
}

/// Emitted when a delegate is added/updated for a package.
/// Includes package context for indexer-friendly reconstruction.
#[contractevent]
pub struct DelegateAdded {
    pub package_id: u64,
    pub recipient: Address,
    pub delegate: Address,
    pub actor: Address,
    pub expires_at: u64,
    pub timestamp: u64,
}

/// Emitted when a delegate is revoked/removed for a package.
/// Includes package context for indexer-friendly reconstruction.
#[contractevent]
pub struct DelegateRevoked {
    pub package_id: u64,
    pub recipient: Address,
    pub delegate: Address,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when a delegate claims a package on behalf of the recipient.
/// Includes package context for indexer-friendly reconstruction.
#[contractevent]
pub struct DelegateClaimed {
    pub package_id: u64,
    pub recipient: Address,
    pub delegate: Address,
    pub amount: i128,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when the current admin nominates a pending admin.
#[contractevent]
pub struct AdminTransferInitiated {
    pub admin: Address,
    pub pending_admin: Address,
    pub timestamp: u64,
}

/// Emitted when the pending admin accepts the admin role.
#[contractevent]
pub struct AdminTransferAccepted {
    pub admin: Address,
    pub timestamp: u64,
}

/// Emitted when the current admin cancels a pending admin transfer.
#[contractevent]
pub struct AdminTransferCancelled {
    pub admin: Address,
    pub timestamp: u64,
}

/// Emitted when a token is added to the allowed tokens allowlist.
#[contractevent]
pub struct TokenAdded {
    pub admin: Address,
    pub token: Address,
    pub timestamp: u64,
}

/// Emitted when a token is removed from the allowed tokens allowlist.
#[contractevent]
pub struct TokenRemoved {
    pub admin: Address,
    pub token: Address,
    pub timestamp: u64,
}

/// Emitted when an evidence hash is attached to a package.
/// Only admin can attach evidence hash, and it cannot overwrite an existing hash.
#[contractevent]
pub struct EvidenceAttached {
    pub package_id: u64,
    pub admin: Address,
    pub evidence_hash: String,
    pub timestamp: u64,
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
            claim_cooldown: 0,
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

    /// Returns the pending admin address, if one has been nominated.
    ///
    /// Returns `None` if no transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&KEY_PENDING_ADMIN)
    }

    /// Admin-only. Nominates `new_admin` as the pending administrator.
    /// The current admin must explicitly call this to initiate a transfer.
    /// The pending admin must then call `accept_admin()` to complete it.
    ///
    /// # Arguments
    /// * `new_admin` — The address to nominate as the next admin.
    ///
    /// # Errors
    /// Returns `Error::NotInitialized` if the contract has not been initialized.
    /// Returns `Error::InvalidPendingAdmin` if `new_admin` equals the current admin.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        if new_admin == admin {
            return Err(Error::InvalidPendingAdmin);
        }

        env.storage().instance().set(&KEY_PENDING_ADMIN, &new_admin);

        let timestamp = env.ledger().timestamp();
        AdminTransferInitiated {
            admin,
            pending_admin: new_admin,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Pending admin-only. Accepts the admin role and completes the transfer.
    /// Only the address nominated via `transfer_admin()` may call this.
    ///
    /// # Errors
    /// Returns `Error::NoPendingTransfer` if no transfer is in progress.
    /// Returns `Error::NotAuthorized` if the caller is not the pending admin.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&KEY_PENDING_ADMIN)
            .ok_or(Error::NoPendingTransfer)?;

        pending_admin.require_auth();

        env.storage().instance().set(&KEY_ADMIN, &pending_admin);
        env.storage().instance().remove(&KEY_PENDING_ADMIN);

        let timestamp = env.ledger().timestamp();
        AdminTransferAccepted {
            admin: pending_admin,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only. Cancels a pending admin transfer.
    ///
    /// # Errors
    /// Returns `Error::NoPendingTransfer` if no transfer is in progress.
    pub fn cancel_admin_transfer(env: Env) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        if !env.storage().instance().has(&KEY_PENDING_ADMIN) {
            return Err(Error::NoPendingTransfer);
        }

        env.storage().instance().remove(&KEY_PENDING_ADMIN);

        let timestamp = env.ledger().timestamp();
        AdminTransferCancelled { admin, timestamp }.publish(&env);

        Ok(())
    }

    /// Returns the current contract version.
    /// Defaults to `0` if the contract has never been initialized.
    pub fn get_version(env: Env) -> u32 {
        env.storage().instance().get(&KEY_VERSION).unwrap_or(0)
    }

    /// Returns the semantic version of the contract package.
    pub fn contract_version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
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
    /// * `config` — New config values (`min_amount`, `max_expires_in`,
    ///   `allowed_tokens`, `claim_cooldown`). Set `claim_cooldown` to zero to
    ///   disable per-recipient throttling.
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

        for i in 0..config.allowed_tokens.len() {
            let token = config.allowed_tokens.get(i).ok_or(Error::InvalidToken)?;
            Self::validate_token(&env, &token)?;
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

    /// Admin-only. Pauses a specific action (create, claim, or withdraw).
    /// Emits an `ActionPausedEvent`.
    pub fn pause_action(env: Env, action: Symbol) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = Self::get_pause_key(action.clone())?;
        env.storage().instance().set(&key, &true);

        ActionPausedEvent { admin, action }.publish(&env);
        Ok(())
    }

    /// Admin-only. Unpauses a specific action.
    /// Emits an `ActionUnpausedEvent`.
    pub fn unpause_action(env: Env, action: Symbol) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = Self::get_pause_key(action.clone())?;
        env.storage().instance().set(&key, &false);

        ActionUnpausedEvent { admin, action }.publish(&env);
        Ok(())
    }

    /// Returns `true` if the specific action is currently paused.
    pub fn is_action_paused(env: Env, action: Symbol) -> bool {
        if Self::is_paused(env.clone()) {
            return true;
        }

        let key = match Self::get_pause_key(action) {
            Ok(k) => k,
            Err(_) => return false,
        };

        env.storage().instance().get(&key).unwrap_or(false)
    }

    /// Returns `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&KEY_PAUSED).unwrap_or(false)
    }

    /// Admin-only. Pauses a single campaign, identified by the `campaign_ref`
    /// metadata value shared by its packages.
    /// While paused, `claim`, `disburse`, and `refund` are blocked for any
    /// package tagged with this `campaign_ref`; other campaigns are unaffected.
    /// Emits a `CampaignPausedEvent`.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn pause_campaign(env: Env, campaign_ref: String) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let mut paused: Map<String, bool> = env
            .storage()
            .instance()
            .get(&KEY_CAMPAIGN_PAUSED)
            .unwrap_or(Map::new(&env));
        paused.set(campaign_ref.clone(), true);
        env.storage().instance().set(&KEY_CAMPAIGN_PAUSED, &paused);

        CampaignPausedEvent {
            admin,
            campaign_ref,
        }
        .publish(&env);
        Ok(())
    }

    /// Admin-only. Unpauses a single campaign.
    /// Emits a `CampaignUnpausedEvent`.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    pub fn unpause_campaign(env: Env, campaign_ref: String) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let mut paused: Map<String, bool> = env
            .storage()
            .instance()
            .get(&KEY_CAMPAIGN_PAUSED)
            .unwrap_or(Map::new(&env));
        paused.set(campaign_ref.clone(), false);
        env.storage().instance().set(&KEY_CAMPAIGN_PAUSED, &paused);

        CampaignUnpausedEvent {
            admin,
            campaign_ref,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns `true` if `campaign_ref` is currently paused, either directly
    /// or because the contract is globally paused (global pause always takes
    /// precedence over campaign-level state).
    pub fn is_campaign_paused(env: Env, campaign_ref: String) -> bool {
        if Self::is_paused(env.clone()) {
            return true;
        }

        let paused: Map<String, bool> = env
            .storage()
            .instance()
            .get(&KEY_CAMPAIGN_PAUSED)
            .unwrap_or(Map::new(&env));
        paused.get(campaign_ref).unwrap_or(false)
    }

    /// Returns the current contract configuration.
    /// Falls back to defaults (`min_amount: 1`, `max_expires_in: 0`, empty token list)
    /// if no config has been explicitly set.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&KEY_CONFIG).unwrap_or(Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
            claim_cooldown: 0,
        })
    }

    // --- Funding & Packages ---

    /// Funds the contract (Pool Model).
    /// Transfers `amount` of `token` from `from` to this contract.
    /// This increases the contract's balance, allowing new packages to be created.
    pub fn fund(env: Env, token: Address, from: Address, amount: i128) -> Result<(), Error> {
        // 1. Basic Validation
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // 2. Validate token interface and fetch decimals dynamically.
        let decimals = Self::validate_token(&env, &token)?;

        // 3. Dynamic Precision Check
        // Instead of checking 6 AND 8, we check ONLY the decimals this token uses.
        let unit = 10i128.pow(decimals);
        if amount % unit != 0 {
            // This ensures the user isn't trying to send a fractional "human" unit
            // if your business logic requires whole-unit funding.
            return Err(Error::InvalidAmount);
        }

        // 4. Authorization
        from.require_auth();

        // 5. Perform Transfer
        Self::transfer_token(
            &env,
            &token,
            &from,
            &env.current_contract_address(),
            &amount,
        )?;

        // 6. Events
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

    /// Creates a package with a specific ID and stores provided metadata.
    /// Locks funds from the available pool (Contract Balance - Total Locked).
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `operator` - Address of the admin or distributor creating the package
    /// * `id` - Unique package ID
    /// * `recipient` - Address of the recipient
    /// * `amount` - Amount to escrow
    /// * `token` - Token contract address
    /// * `expires_at` - Expiration timestamp (0 for no expiration)
    /// * `metadata` - Arbitrary key-value metadata for the package
    #[allow(clippy::too_many_arguments)]
    pub fn create_package(
        env: Env,
        operator: Address,
        id: u64,
        recipient: Address,
        amount: i128,
        token: Address,
        expires_at: u64,
        metadata: Map<Symbol, String>,
    ) -> Result<u64, Error> {
        Self::check_action_paused(&env, symbol_short!("create"))?;
        Self::require_admin_or_distributor(&env, &operator)?;
        let config = Self::get_config(env.clone());

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // --- DYNAMIC PRECISION CHECK ---
        // Fetch the actual decimals from a validated token contract.
        let decimals = Self::validate_token(&env, &token)?;
        let unit = 10i128.pow(decimals);

        // Enforce that only whole units can be used (if that is your business requirement).
        // If you want to allow fractional units (e.g., 0.1 tokens), remove this check.
        if amount % unit != 0 {
            return Err(Error::InvalidAmount);
        }

        if amount < config.min_amount {
            return Err(Error::InvalidAmount);
        }

        // --- REST OF VALIDATIONS ---
        if !config.allowed_tokens.is_empty() && !config.allowed_tokens.contains(token.clone()) {
            return Err(Error::InvalidState);
        }

        if config.max_expires_in > 0 {
            let now = env.ledger().timestamp();
            if expires_at == 0 || expires_at <= now || expires_at - now > config.max_expires_in {
                return Err(Error::InvalidState);
            }
        }

        let key = crate::keys::package_key(id);
        if env.storage().persistent().has(&key) {
            return Err(Error::PackageIdExists);
        }

        // --- SOLVENCY CHECK ---
        let contract_balance = Self::token_balance(&env, &token, &env.current_contract_address())?;

        let mut locked_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_LOCKED)
            .unwrap_or(Map::new(&env));

        let current_locked = locked_map.get(token.clone()).unwrap_or(0);

        if contract_balance < current_locked + amount {
            return Err(Error::InsufficientFunds);
        }

        // --- STATE UPDATES ---
        locked_map.set(token.clone(), current_locked + amount);
        env.storage().instance().set(&KEY_TOTAL_LOCKED, &locked_map);

        let created_at = env.ledger().timestamp();
        let claim_starts_at = Self::resolve_claim_starts_at(&env, &metadata, created_at)?;

        if claim_starts_at < created_at || (expires_at > 0 && claim_starts_at > expires_at) {
            return Err(Error::InvalidState);
        }

        let package = Package {
            id,
            recipient: recipient.clone(),
            amount,
            token: token.clone(),
            status: PackageStatus::Created,
            created_at,
            expires_at,
            claim_starts_at,
            metadata,
            evidence_hash: String::from_str(&env, ""),
        };

        env.storage().persistent().set(&key, &package);
        crate::ttl::bump_persistent(&env, &key);

        let counter: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        if id >= counter {
            env.storage().instance().set(&KEY_PKG_COUNTER, &(id + 1));
        }

        let idx: u64 = env.storage().instance().get(&KEY_PKG_IDX).unwrap_or(0);
        let idx_key = crate::keys::package_index_entry(idx);
        env.storage().persistent().set(&idx_key, &id);
        crate::ttl::bump_persistent(&env, &idx_key);
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
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `operator` - Address of the admin or distributor creating the packages
    /// * `recipients` - List of recipient addresses
    /// * `amounts` - List of amounts to escrow (must match recipients)
    /// * `token` - Token contract address
    /// * `expires_in` - Expiry duration in seconds from now
    /// * `metadatas` - List of metadata maps, one per package
    pub fn batch_create_packages(
        env: Env,
        operator: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
        token: Address,
        expires_in: u64,
        metadatas: Vec<Map<Symbol, String>>,
    ) -> Result<Vec<u64>, Error> {
        Self::check_action_paused(&env, symbol_short!("create"))?;
        Self::require_admin_or_distributor(&env, &operator)?;
        let config = Self::get_config(env.clone());

        // Validate array lengths match
        if recipients.len() != amounts.len() || recipients.len() != metadatas.len() {
            return Err(Error::MismatchedArrays);
        }

        if !config.allowed_tokens.is_empty() && !config.allowed_tokens.contains(token.clone()) {
            return Err(Error::InvalidState);
        }

        if config.max_expires_in > 0 && (expires_in == 0 || expires_in > config.max_expires_in) {
            return Err(Error::InvalidState);
        }

        let decimals = Self::validate_token(&env, &token)?;
        let unit = 10i128.pow(decimals);
        let contract_balance = Self::token_balance(&env, &token, &env.current_contract_address())?;

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
            let metadata = metadatas.get(i).unwrap();
            let claim_starts_at = Self::resolve_claim_starts_at(&env, &metadata, created_at)?;

            if claim_starts_at > expires_at {
                return Err(Error::InvalidState);
            }

            // Validate amount
            if amount <= 0 {
                return Err(Error::InvalidAmount);
            }

            if amount < config.min_amount || amount % unit != 0 {
                return Err(Error::InvalidAmount);
            }

            // Check solvency
            if contract_balance < current_locked + amount {
                return Err(Error::InsufficientFunds);
            }

            // Assign ID and increment counter
            let id = counter;
            counter += 1;

            let key = crate::keys::package_key(id);

            // Create package
            let package = Package {
                id,
                recipient: recipient.clone(),
                amount,
                token: token.clone(),
                status: PackageStatus::Created,
                created_at,
                expires_at,
                claim_starts_at,
                metadata: metadata.clone(),
                evidence_hash: String::from_str(&env, ""),
            };

            env.storage().persistent().set(&key, &package);

            // Track package index for aggregation
            let idx_key = crate::keys::package_index_entry(idx);
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
        Self::check_action_paused(&env, symbol_short!("claim"))?;
        let key = crate::keys::package_key(id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        Self::check_campaign_paused(&env, &package.metadata)?;

        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        let now = env.ledger().timestamp();
        if now < package.claim_starts_at {
            return Err(Error::ClaimTooEarly);
        }

        if package.expires_at > 0 && now > package.expires_at {
            return Err(Error::PackageExpired);
        }

        // Packages configured with a Merkle allowlist must be claimed through
        // claim_with_proof so eligibility can be verified.
        if Self::merkle_root_from_metadata(&env, &package.metadata).is_some() {
            return Err(Error::InvalidProof);
        }

        package.recipient.require_auth();
        let payout_recipient = package.recipient.clone();
        let claimant = package.recipient.clone();

        Self::finalize_claim(
            &env,
            &key,
            &mut package,
            id,
            &payout_recipient,
            &claimant,
            now,
        )
    }

    /// Claim a package guarded by an optional Merkle allowlist.
    ///
    /// If package metadata includes `merkle_root` (hex-encoded 32-byte value),
    /// `proof` must contain sibling hashes (hex-encoded 32-byte values) that
    /// validate the claimant leaf `sha256(claimant_address_string)`.
    ///
    /// For non-Merkle packages this still works as a direct claim when
    /// `claimant` equals the stored recipient.
    pub fn claim_with_proof(
        env: Env,
        id: u64,
        claimant: Address,
        proof: Vec<String>,
    ) -> Result<(), Error> {
        Self::check_action_paused(&env, symbol_short!("claim"))?;
        let key = crate::keys::package_key(id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;
        crate::ttl::bump_persistent(&env, &key);

        Self::check_campaign_paused(&env, &package.metadata)?;

        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        let now = env.ledger().timestamp();
        if now < package.claim_starts_at {
            return Err(Error::ClaimTooEarly);
        }

        if package.expires_at > 0 && now > package.expires_at {
            return Err(Error::PackageExpired);
        }

        claimant.require_auth();

        match Self::merkle_root_from_metadata(&env, &package.metadata) {
            Some(root) => {
                if !Self::verify_merkle_proof_for_claimant(&env, &claimant, &proof, root) {
                    return Err(Error::InvalidProof);
                }
                Self::finalize_claim(&env, &key, &mut package, id, &claimant, &claimant, now)
            }
            None => {
                if claimant != package.recipient {
                    // Check if claimant is the registered delegate
                    let delegate = crate::delegate::get_delegate(&env, id);
                    if delegate.is_none() || delegate.unwrap() != claimant {
                        return Err(Error::NotAuthorized);
                    }
                }
                Self::finalize_claim(&env, &key, &mut package, id, &claimant, &claimant, now)
            }
        }
    }

    /// Claim a package through a relayer who pays the transaction costs.
    ///
    /// The `claimant` must be the package recipient or an authorized delegate.
    /// Both the `claimant` and the `relayer` must have signed the transaction.
    /// The relayer's address is recorded in the event for off-chain identification.
    ///
    /// Merkle-allowlist packages cannot be claimed through this path; use
    /// `claim_with_proof` instead.
    pub fn claim_with_relayer(
        env: Env,
        id: u64,
        claimant: Address,
        relayer: Address,
    ) -> Result<(), Error> {
        Self::check_action_paused(&env, symbol_short!("claim"))?;
        let key = crate::keys::package_key(id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        Self::check_campaign_paused(&env, &package.metadata)?;

        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        let now = env.ledger().timestamp();
        if now < package.claim_starts_at {
            return Err(Error::ClaimTooEarly);
        }

        if package.expires_at > 0 && now > package.expires_at {
            return Err(Error::PackageExpired);
        }

        if Self::merkle_root_from_metadata(&env, &package.metadata).is_some() {
            return Err(Error::InvalidProof);
        }

        if !delegate::is_authorised_claimer(&env, id, &package.recipient, &claimant) {
            return Err(Error::NotAuthorized);
        }

        Self::ensure_recipient_cooldown(&env, &package.recipient, now)?;

        claimant.require_auth();
        relayer.require_auth();

        delegate::clear_delegate(&env, id);

        Self::transfer_token(
            &env,
            &package.token,
            &env.current_contract_address(),
            &claimant,
            &package.amount,
        )?;

        package.status = PackageStatus::Claimed;
        env.storage().persistent().set(&key, &package);

        Self::decrement_locked(&env, &package.token, package.amount);

        let mut claimed_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_CLAIMED)
            .unwrap_or(Map::new(&env));
        let current_total = claimed_map.get(package.token.clone()).unwrap_or(0);
        claimed_map.set(package.token.clone(), current_total + package.amount);
        env.storage()
            .instance()
            .set(&KEY_TOTAL_CLAIMED, &claimed_map);
        Self::record_recipient_claim(&env, &package.recipient, now);

        PackageClaimedByRelayer {
            package_id: id,
            recipient: claimant.clone(),
            relayer,
            amount: package.amount,
            timestamp: now,
        }
        .publish(&env);

        Ok(())
    }

    /// Claims multiple packages in a single invocation.
    ///
    /// `claimant` must authorize the call once; eligibility (ownership or
    /// active delegation, timing, campaign pause, Merkle-gating) is then
    /// checked independently for each package id. A package failing its
    /// checks does not abort the batch or affect any other package - its
    /// outcome is simply recorded as a non-`Success` `ClaimStatus` in the
    /// returned results. Fund transfers and accounting updates only happen
    /// for packages that resolve to `ClaimStatus::Success`.
    ///
    /// When a cooldown is enabled, ids are processed in order. The first
    /// successful claim records the recipient timestamp; later ids for that
    /// recipient in the same batch return `ClaimStatus::CooldownActive`.
    ///
    /// Returns `Err(Error::BatchTooLarge)` if more than
    /// `MAX_BATCH_CLAIM_SIZE` ids are supplied, without touching any package.
    pub fn batch_claim(
        env: Env,
        claimant: Address,
        ids: Vec<u64>,
    ) -> Result<Vec<BatchClaimResult>, Error> {
        Self::check_action_paused(&env, symbol_short!("claim"))?;

        if ids.len() > MAX_BATCH_CLAIM_SIZE {
            return Err(Error::BatchTooLarge);
        }

        claimant.require_auth();

        let now = env.ledger().timestamp();
        let mut results = Vec::new(&env);
        for id in ids.iter() {
            results.push_back(Self::claim_one_for_batch(&env, &claimant, id, now));
        }

        Ok(results)
    }

    /// Evaluates and, if eligible, finalizes a single package claim as part
    /// of `batch_claim`. Never panics on an ineligible package; the reason
    /// is reported back via `ClaimStatus` instead.
    fn claim_one_for_batch(env: &Env, claimant: &Address, id: u64, now: u64) -> BatchClaimResult {
        let not_claimable = |status: ClaimStatus| BatchClaimResult {
            package_id: id,
            status,
            amount: 0,
        };

        let key = crate::keys::package_key(id);
        let mut package: Package = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => return not_claimable(ClaimStatus::NotFound),
        };

        if Self::check_campaign_paused(env, &package.metadata).is_err() {
            return not_claimable(ClaimStatus::CampaignPaused);
        }

        if package.status != PackageStatus::Created {
            return not_claimable(ClaimStatus::NotActive);
        }

        if now < package.claim_starts_at {
            return not_claimable(ClaimStatus::ClaimTooEarly);
        }

        if package.expires_at > 0 && now > package.expires_at {
            return not_claimable(ClaimStatus::Expired);
        }

        if Self::merkle_root_from_metadata(env, &package.metadata).is_some() {
            return not_claimable(ClaimStatus::RequiresProof);
        }

        if !delegate::is_authorised_claimer(env, id, &package.recipient, claimant) {
            return not_claimable(ClaimStatus::Unauthorized);
        }

        if Self::ensure_recipient_cooldown(env, &package.recipient, now).is_err() {
            return not_claimable(ClaimStatus::CooldownActive);
        }

        let amount = package.amount;
        match Self::finalize_claim(env, &key, &mut package, id, claimant, claimant, now) {
            Ok(()) => BatchClaimResult {
                package_id: id,
                status: ClaimStatus::Success,
                amount,
            },
            Err(_) => not_claimable(ClaimStatus::TransferFailed),
        }
    }

    // --- Admin Actions ---

    /// Admin manually triggers disbursement (overrides recipient claim need, strictly checks status).
    pub fn disburse(env: Env, id: u64) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = crate::keys::package_key(id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        Self::check_campaign_paused(&env, &package.metadata)?;

        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        // Transfer before accounting updates so reverted token transfers cannot
        // leave the escrow state inconsistent.
        Self::transfer_token(
            &env,
            &package.token,
            &env.current_contract_address(),
            &package.recipient,
            &package.amount,
        )?;

        // State Transition
        package.status = PackageStatus::Claimed;
        env.storage().persistent().set(&key, &package);

        // Update Locked
        Self::decrement_locked(&env, &package.token, package.amount);

        let timestamp = env.ledger().timestamp();
        let receipt_hash = Self::receipt_hash_from_metadata(&env, &package.metadata);
        PackageDisbursed {
            package_id: id,
            recipient: package.recipient.clone(),
            amount: package.amount,
            actor: admin.clone(),
            timestamp,
            receipt_hash,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin reassigns an unclaimed package to a new recipient.
    pub fn reassign_package(
        env: Env,
        package_id: u64,
        new_recipient: Address,
    ) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = crate::keys::package_key(package_id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        if package.status != PackageStatus::Created {
            return Err(Error::PackageNotActive);
        }

        let now = env.ledger().timestamp();
        if package.expires_at > 0 && now > package.expires_at {
            return Err(Error::PackageExpired);
        }

        let previous_recipient = package.recipient.clone();
        package.recipient = new_recipient.clone();
        env.storage().persistent().set(&key, &package);

        PackageReassigned {
            package_id,
            previous_recipient,
            new_recipient,
            actor: admin,
            timestamp: now,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin revokes a package (Cancels it). Funds are effectively unlocked but remain in contract pool.
    pub fn revoke(env: Env, id: u64) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = crate::keys::package_key(id);
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
        Self::check_action_paused(&env, symbol_short!("refund"))?;
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        let key = crate::keys::package_key(id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        Self::check_campaign_paused(&env, &package.metadata)?;

        // Can only refund if Expired or Cancelled.
        // If Created, must Revoke first. If Claimed, impossible.
        // If Refunded, impossible.
        let should_unlock_locked =
            package.status == PackageStatus::Created || package.status == PackageStatus::Expired;

        if package.status == PackageStatus::Created {
            // Check if actually expired
            if package.expires_at > 0 && env.ledger().timestamp() > package.expires_at {
                package.status = PackageStatus::Expired;
            } else {
                return Err(Error::InvalidState);
            }
        } else if package.status == PackageStatus::Claimed
            || package.status == PackageStatus::Refunded
        {
            return Err(Error::InvalidState);
        }

        // If Cancelled, funds were already unlocked in `revoke`.
        // Expired packages are unlocked only after a successful refund transfer.

        // Transfer Contract -> Admin
        Self::transfer_token(
            &env,
            &package.token,
            &env.current_contract_address(),
            &admin,
            &package.amount,
        )?;

        if should_unlock_locked {
            Self::decrement_locked(&env, &package.token, package.amount);
        }

        // State Transition
        package.status = PackageStatus::Refunded;
        env.storage().persistent().set(&key, &package);

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
        let key = crate::keys::package_key(package_id);
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

    /// Admin-only function to attach an evidence hash to a package.
    /// The evidence hash is a 64-character hex string (32 bytes) that anchors
    /// off-chain verification evidence to the on-chain package.
    /// Cannot overwrite an existing evidence hash.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must be authenticated)
    /// * `package_id` - Package ID to attach evidence to
    /// * `evidence_hash` - 64-character hex string representing the evidence hash
    ///
    /// # Errors
    /// - `Error::NotAuthorized` - Caller is not the admin
    /// - `Error::PackageNotFound` - Package doesn't exist
    /// - `Error::InvalidState` - Package already has an evidence hash, or hash format is invalid
    pub fn attach_evidence_hash(
        env: Env,
        admin: Address,
        package_id: u64,
        evidence_hash: String,
    ) -> Result<(), Error> {
        admin.require_auth();

        let config_admin = Self::get_admin(env.clone())?;
        if admin != config_admin {
            return Err(Error::NotAuthorized);
        }

        let key = crate::keys::package_key(package_id);
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        if !package.evidence_hash.is_empty() {
            return Err(Error::InvalidState);
        }

        Self::validate_evidence_hash(&env, &evidence_hash)?;

        package.evidence_hash = evidence_hash.clone();
        env.storage().persistent().set(&key, &package);

        let timestamp = env.ledger().timestamp();
        EvidenceAttached {
            package_id,
            admin,
            evidence_hash,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only package expiration extension using a relative time delta.
    ///
    /// # Deprecated
    /// This function is deprecated in favor of `extend_expiry` which uses absolute timestamps.
    /// This function will be removed in a future version.
    ///
    /// Requirements: Admin auth, existing package, status must be 'Created', additional_time > 0.
    /// Behavior: Adds additional_time to the package's expires_at timestamp.
    /// Cannot extend unbounded packages (expires_at == 0).
    #[deprecated(note = "Use extend_expiry with absolute timestamp instead")]
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

        let key = crate::keys::package_key(id);
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
            package_id: id,
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
        Self::check_action_paused(&env, symbol_short!("withdraw"))?;
        // 1. Only the admin can withdraw surplus
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        // 2. Validate amount
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // 3. Get contract's current balance for the token
        Self::validate_token(&env, &token)?;
        let contract_balance = Self::token_balance(&env, &token, &env.current_contract_address())?;

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
        Self::transfer_token(&env, &token, &env.current_contract_address(), &to, &amount)?;

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

    fn check_action_paused(env: &Env, action: Symbol) -> Result<(), Error> {
        if env.storage().instance().get(&KEY_PAUSED).unwrap_or(false) {
            return Err(Error::ContractPaused);
        }

        let key = match Self::get_pause_key(action) {
            Ok(k) => k,
            Err(_) => return Ok(()),
        };

        if env.storage().instance().get(&key).unwrap_or(false) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn get_pause_key(action: Symbol) -> Result<Symbol, Error> {
        if action == symbol_short!("create") {
            Ok(KEY_PAUSE_CREATE)
        } else if action == symbol_short!("claim") {
            Ok(KEY_PAUSE_CLAIM)
        } else if action == symbol_short!("withdraw") {
            Ok(KEY_PAUSE_WITHDRAW)
        } else if action == symbol_short!("refund") {
            Ok(KEY_PAUSE_REFUND)
        } else {
            Err(Error::InvalidState)
        }
    }

    /// Extracts the `campaign_ref` metadata value from a package, if present.
    fn campaign_ref_from_metadata(env: &Env, metadata: &Map<Symbol, String>) -> Option<String> {
        let key = Symbol::new(env, keys::META_CAMPAIGN_REF);
        metadata.get(key)
    }

    /// Blocks the caller's action if the package's campaign is paused, or if
    /// the contract is globally paused. Global pause always takes precedence;
    /// packages without a `campaign_ref` are never blocked by campaign state.
    fn check_campaign_paused(env: &Env, metadata: &Map<Symbol, String>) -> Result<(), Error> {
        if Self::is_paused(env.clone()) {
            return Err(Error::ContractPaused);
        }

        let campaign_ref = match Self::campaign_ref_from_metadata(env, metadata) {
            Some(r) => r,
            None => return Ok(()),
        };

        let paused: Map<String, bool> = env
            .storage()
            .instance()
            .get(&KEY_CAMPAIGN_PAUSED)
            .unwrap_or(Map::new(env));
        if paused.get(campaign_ref).unwrap_or(false) {
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

    fn validate_token(env: &Env, token: &Address) -> Result<u32, Error> {
        let args: Vec<Val> = Vec::new(env);

        match env.try_invoke_contract::<u32, Error>(token, &symbol_short!("decimals"), args) {
            Ok(Ok(decimals)) if decimals <= 38 => Ok(decimals),
            _ => Err(Error::InvalidToken),
        }
    }

    fn token_balance(env: &Env, token: &Address, account: &Address) -> Result<i128, Error> {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(account.clone().into_val(env));

        match env.try_invoke_contract::<i128, Error>(token, &symbol_short!("balance"), args) {
            Ok(Ok(balance)) => Ok(balance),
            _ => Err(Error::InvalidToken),
        }
    }

    fn transfer_token(
        env: &Env,
        token: &Address,
        from: &Address,
        to: &Address,
        amount: &i128,
    ) -> Result<(), Error> {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(from.clone().into_val(env));
        args.push_back(to.clone().into_val(env));
        args.push_back((*amount).into_val(env));

        match env.try_invoke_contract::<(), Error>(token, &symbol_short!("transfer"), args) {
            Ok(Ok(())) => Ok(()),
            _ => Err(Error::TokenTransferFailed),
        }
    }

    fn resolve_claim_starts_at(
        env: &Env,
        metadata: &Map<Symbol, String>,
        created_at: u64,
    ) -> Result<u64, Error> {
        let key = Symbol::new(env, keys::META_CLAIM_STARTS_AT);
        match metadata.get(key) {
            Some(raw) => Self::parse_u64(raw).ok_or(Error::InvalidState),
            None => Ok(created_at),
        }
    }

    fn parse_u64(value: String) -> Option<u64> {
        let len = value.len() as usize;
        if len == 0 || len > 20 {
            return None;
        }

        let mut bytes = [0u8; 20];
        value.copy_into_slice(&mut bytes[..len]);

        let mut out: u64 = 0;
        for b in bytes[..len].iter() {
            if !b.is_ascii_digit() {
                return None;
            }
            out = out.checked_mul(10)?.checked_add((b - b'0') as u64)?;
        }

        Some(out)
    }

    fn finalize_claim(
        env: &Env,
        key: &(Symbol, u64),
        package: &mut Package,
        package_id: u64,
        payout_recipient: &Address,
        claimant: &Address,
        now: u64,
    ) -> Result<(), Error> {
        Self::ensure_recipient_cooldown(env, &package.recipient, now)?;
        Self::transfer_token(
            env,
            &package.token,
            &env.current_contract_address(),
            payout_recipient,
            &package.amount,
        )?;

        // State Transition
        package.status = PackageStatus::Claimed;
        env.storage().persistent().set(key, package);

        // Update Global Locked (Bookkeeping)
        Self::decrement_locked(env, &package.token, package.amount);

        let mut claimed_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_CLAIMED)
            .unwrap_or(Map::new(env));
        let current_total = claimed_map.get(package.token.clone()).unwrap_or(0);
        claimed_map.set(package.token.clone(), current_total + package.amount);
        env.storage()
            .instance()
            .set(&KEY_TOTAL_CLAIMED, &claimed_map);
        Self::record_recipient_claim(env, &package.recipient, now);

        // Check if claimant is a delegate (not the recipient)
        let is_delegate = claimant != &package.recipient;

        let receipt_hash = Self::receipt_hash_from_metadata(env, &package.metadata);

        PackageClaimed {
            package_id,
            recipient: payout_recipient.clone(),
            amount: package.amount,
            actor: payout_recipient.clone(),
            timestamp: now,
            receipt_hash,
        }
        .publish(env);

        // A claim finalizes the package; clear any registered delegate so it
        // cannot be reused, regardless of whether the recipient or a delegate claimed.
        crate::delegate::clear_delegate(env, package_id);

        // If claimed by delegate, emit DelegateClaimed event
        if is_delegate {
            // Emit DelegateClaimed event
            DelegateClaimed {
                package_id,
                recipient: package.recipient.clone(),
                delegate: claimant.clone(),
                amount: package.amount,
                actor: claimant.clone(),
                timestamp: now,
            }
            .publish(env);

            // Emit DelegateRevoked with claimant as actor (system-initiated on claim)
            DelegateRevoked {
                package_id,
                recipient: package.recipient.clone(),
                delegate: claimant.clone(),
                actor: claimant.clone(), // The delegate who claimed acts as the actor for revocation
                timestamp: now,
            }
            .publish(env);
        }

        Ok(())
    }

    /// Rejects claims made before a recipient's configured cooldown window
    /// expires. The recipient (rather than a delegate or relayer) is tracked,
    /// so alternate claim paths cannot bypass the limit.
    fn ensure_recipient_cooldown(env: &Env, recipient: &Address, now: u64) -> Result<(), Error> {
        let cooldown = Self::get_config(env.clone()).claim_cooldown;
        if cooldown == 0 {
            return Ok(());
        }

        let claims: Map<Address, u64> = env
            .storage()
            .instance()
            .get(&KEY_RECIPIENT_LAST_CLAIM)
            .unwrap_or(Map::new(env));
        if let Some(last_claim) = claims.get(recipient.clone()) {
            if now.saturating_sub(last_claim) < cooldown {
                return Err(Error::ClaimCooldownActive);
            }
        }
        Ok(())
    }

    fn record_recipient_claim(env: &Env, recipient: &Address, now: u64) {
        let mut claims: Map<Address, u64> = env
            .storage()
            .instance()
            .get(&KEY_RECIPIENT_LAST_CLAIM)
            .unwrap_or(Map::new(env));
        claims.set(recipient.clone(), now);
        env.storage()
            .instance()
            .set(&KEY_RECIPIENT_LAST_CLAIM, &claims);
    }

    fn receipt_hash_from_metadata(env: &Env, metadata: &Map<Symbol, String>) -> String {
        let key = Symbol::new(env, keys::META_RECEIPT_HASH);
        metadata.get(key).unwrap_or(String::from_str(env, ""))
    }

    fn merkle_root_from_metadata(env: &Env, metadata: &Map<Symbol, String>) -> Option<[u8; 32]> {
        let root_key = Symbol::new(env, keys::META_MERKLE_ROOT_KEY);
        metadata
            .get(root_key)
            .and_then(|hex| Self::parse_hex_32(&hex))
    }

    fn verify_merkle_proof_for_claimant(
        env: &Env,
        claimant: &Address,
        proof: &Vec<String>,
        expected_root: [u8; 32],
    ) -> bool {
        let mut current = Self::hash_address(env, claimant);

        for i in 0..proof.len() {
            let sibling_hex = match proof.get(i) {
                Some(v) => v,
                None => return false,
            };

            let sibling = match Self::parse_hex_32(&sibling_hex) {
                Some(v) => v,
                None => return false,
            };

            current = if current <= sibling {
                Self::hash_pair(env, &current, &sibling)
            } else {
                Self::hash_pair(env, &sibling, &current)
            };
        }

        current == expected_root
    }

    fn hash_address(env: &Env, address: &Address) -> [u8; 32] {
        let addr = address.to_string();
        let len = addr.len() as usize;
        let mut raw = [0u8; 96];
        addr.copy_into_slice(&mut raw[..len]);

        let mut data = Bytes::new(env);
        for b in raw[..len].iter() {
            data.push_back(*b);
        }

        let digest = env.crypto().sha256(&data);
        Self::hash_to_array(&digest)
    }

    fn hash_pair(env: &Env, left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
        let mut data = Bytes::new(env);
        for b in left.iter() {
            data.push_back(*b);
        }
        for b in right.iter() {
            data.push_back(*b);
        }

        let digest = env.crypto().sha256(&data);
        Self::hash_to_array(&digest)
    }

    fn hash_to_array(value: &soroban_sdk::crypto::Hash<32>) -> [u8; 32] {
        value.to_array()
    }

    fn parse_hex_32(value: &String) -> Option<[u8; 32]> {
        let len = value.len() as usize;
        if len != 64 {
            return None;
        }

        let mut raw = [0u8; 64];
        value.copy_into_slice(&mut raw);

        let mut out = [0u8; 32];
        let mut i = 0usize;
        while i < 32 {
            let hi = Self::hex_nibble(raw[i * 2])?;
            let lo = Self::hex_nibble(raw[i * 2 + 1])?;
            out[i] = (hi << 4) | lo;
            i += 1;
        }

        Some(out)
    }

    fn hex_nibble(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(10 + (b - b'a')),
            b'A'..=b'F' => Some(10 + (b - b'A')),
            _ => None,
        }
    }

    /// Validates that the evidence hash is a 64-character hex string (32 bytes).
    fn validate_evidence_hash(_env: &Env, hash: &String) -> Result<(), Error> {
        let len = hash.len() as usize;
        if len != 64 {
            return Err(Error::InvalidState);
        }

        let mut raw = [0u8; 64];
        hash.copy_into_slice(&mut raw);

        for byte in &raw {
            if Self::hex_nibble(*byte).is_none() {
                return Err(Error::InvalidState);
            }
        }

        Ok(())
    }

    /// Returns the total amount currently locked for a specific token.
    pub fn get_total_locked(env: Env, token: Address) -> i128 {
        let locked_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_LOCKED)
            .unwrap_or(Map::new(&env));
        locked_map.get(token).unwrap_or(0)
    }

    /// Returns the cumulative amount ever claimed for a specific token.
    pub fn get_total_claimed(env: Env, token: Address) -> i128 {
        let claimed_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&KEY_TOTAL_CLAIMED)
            .unwrap_or(Map::new(&env));
        claimed_map.get(token).unwrap_or(0)
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
        let key = crate::keys::package_key(id);
        let pkg = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;
        crate::ttl::bump_persistent(&env, &key);
        Ok(pkg)
    }

    /// Returns only the status of a package.
    /// Cheaper alternative to get_package for polling frontends.
    pub fn view_package_status(env: Env, id: u64) -> Result<PackageStatus, Error> {
        let pkg = Self::get_package(env, id)?;
        Ok(pkg.status)
    }

    /// Returns the evidence hash attached to a package.
    /// Returns empty string if no evidence hash has been attached.
    ///
    /// # Errors
    /// Returns `Error::PackageNotFound` if no package exists with the given `id`.
    pub fn get_evidence_hash(env: Env, id: u64) -> Result<String, Error> {
        let pkg = Self::get_package(env, id)?;
        Ok(pkg.evidence_hash)
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
            let idx_key = crate::keys::package_index_entry(i);
            if let Some(pkg_id) = env.storage().persistent().get::<_, u64>(&idx_key) {
                let pkg_key = crate::keys::package_key(pkg_id);
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

    /// Returns the number of stored packages associated with a `campaign_ref` metadata value.
    ///
    /// This read-only helper scans all package IDs from `0..package_counter`, treating the
    /// counter as an upper bound over assigned IDs and skipping gaps. It never mutates
    /// storage and is safe to use for dashboard metrics.
    pub fn get_campaign_package_count(env: Env, campaign_ref: String) -> u64 {
        let count: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        let campaign_key = Symbol::new(&env, keys::META_CAMPAIGN_REF);
        let mut matches = 0;

        for id in 0..count {
            let key = crate::keys::package_key(id);
            if let Some(package) = env.storage().persistent().get::<_, Package>(&key) {
                if package.metadata.get(campaign_key.clone()).as_ref() == Some(&campaign_ref) {
                    matches += 1;
                }
            }
        }

        matches
    }

    /// Returns the number of claimed packages associated with a `campaign_ref` metadata value.
    ///
    /// This helper is intentionally read-only and deterministic: it performs a full scan
    /// over persisted package records and counts only packages whose status is `Claimed`.
    pub fn get_campaign_claim_count(env: Env, campaign_ref: String) -> u64 {
        let count: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        let campaign_key = Symbol::new(&env, keys::META_CAMPAIGN_REF);
        let mut matches = 0;

        for id in 0..count {
            let key = crate::keys::package_key(id);
            if let Some(package) = env.storage().persistent().get::<_, Package>(&key) {
                if package.status == PackageStatus::Claimed
                    && package.metadata.get(campaign_key.clone()).as_ref() == Some(&campaign_ref)
                {
                    matches += 1;
                }
            }
        }

        matches
    }

    /// Returns the number of stored packages assigned to `recipient`.
    ///
    /// This naive helper scans all package IDs from `0..package_counter`, treating the
    /// counter as an upper bound over assigned IDs and skipping gaps.
    pub fn get_recipient_package_count(env: Env, recipient: Address) -> u64 {
        let count: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        let mut matches = 0;

        for id in 0..count {
            let key = crate::keys::package_key(id);
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
    /// * `cursor` - Starting position for pagination (0-indexed offset into the
    ///              global package ID space; if `cursor >= package_counter` an
    ///              empty result is returned)
    /// * `limit` - Maximum number of results to return; capped at
    ///             [`MAX_PAGE_SIZE`] to keep the call within Soroban resource
    ///             limits
    ///
    /// # Returns
    /// A `Vec<u64>` containing package IDs that belong to the recipient,
    /// starting from `cursor` and bounded by the effective `limit`.
    /// Use [`get_recipient_package_count`] to obtain the total count for
    /// constructing subsequent page requests.
    pub fn list_recipient_packages(
        env: Env,
        recipient: Address,
        cursor: u64,
        limit: u32,
    ) -> Vec<u64> {
        let package_counter: u64 = env.storage().instance().get(&KEY_PKG_COUNTER).unwrap_or(0);
        let mut result: Vec<u64> = Vec::new(&env);

        // Enforce the page-size cap so callers cannot request unbounded reads.
        let effective_limit = limit.min(MAX_PAGE_SIZE);

        // Out-of-range cursor: nothing to return.
        if cursor >= package_counter {
            return result;
        }

        // Calculate the end position: cursor + effective_limit or package_counter,
        // whichever comes first.
        let end_pos = (cursor.saturating_add(effective_limit as u64)).min(package_counter);

        // Iterate from cursor to end_pos
        for id in cursor..end_pos {
            let key = crate::keys::package_key(id);
            if let Some(package) = env.storage().persistent().get::<_, Package>(&key) {
                if package.recipient == recipient {
                    result.push_back(id);
                }
            }
        }

        result
    }

    // --- Delegate Operations ---

    /// Sets a delegate for a package. Only the admin can call this.
    /// The delegate can claim the package on behalf of the recipient.
    /// Emits a `DelegateAdded` event.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must be authenticated)
    /// * `package_id` - Package ID to set delegate for
    /// * `delegate` - Delegate address
    ///
    /// # Errors
    /// - `Error::PackageNotFound` - Package doesn't exist
    /// - `Error::PackageNotActive` - Package already claimed
    /// - `Error::InvalidState` - Delegate cannot be set to recipient address
    pub fn set_delegate(
        env: Env,
        admin: Address,
        package_id: u64,
        delegate: Address,
    ) -> Result<(), Error> {
        admin.require_auth();

        // Validate package state
        let key = crate::keys::package_key(package_id);
        let package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        if package.status == PackageStatus::Claimed {
            return Err(Error::PackageNotActive);
        }

        // Prevent setting delegate to the same address as recipient
        if delegate == package.recipient {
            return Err(Error::InvalidState);
        }

        // Use the delegate module function
        crate::delegate::set_delegate(&env, &admin, package_id, &delegate)?;

        // Emit event
        let timestamp = env.ledger().timestamp();
        // Get expiry if any
        let expiry_map: Map<u64, u64> = env
            .storage()
            .persistent()
            .get(&KEY_DELEGATE_EXPIRY)
            .unwrap_or(Map::new(&env));
        let expires_at = expiry_map.get(package_id).unwrap_or(0);

        DelegateAdded {
            package_id,
            recipient: package.recipient.clone(),
            delegate: delegate.clone(),
            actor: admin.clone(),
            expires_at,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Sets a delegate for a package with an expiration time.
    /// Only the admin can call this.
    /// Emits a `DelegateAdded` event.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must be authenticated)
    /// * `package_id` - Package ID to set delegate for
    /// * `delegate` - Delegate address
    /// * `expires_at` - Expiration timestamp (0 = no expiration)
    ///
    /// # Errors
    /// - `Error::PackageNotFound` - Package doesn't exist
    /// - `Error::PackageNotActive` - Package already claimed
    /// - `Error::InvalidState` - Invalid delegate address or expiration
    pub fn set_delegate_with_expiry(
        env: Env,
        admin: Address,
        package_id: u64,
        delegate: Address,
        expires_at: u64,
    ) -> Result<(), Error> {
        admin.require_auth();

        // Validate expiration time
        let now = env.ledger().timestamp();
        if expires_at > 0 && expires_at <= now {
            return Err(Error::InvalidState);
        }

        // Validate package state
        let key = crate::keys::package_key(package_id);
        let package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        if package.status == PackageStatus::Claimed {
            return Err(Error::PackageNotActive);
        }

        // Prevent setting delegate to the same address as recipient
        if delegate == package.recipient {
            return Err(Error::InvalidState);
        }

        // Use the delegate module function
        crate::delegate::set_delegate_with_expiry(&env, &admin, package_id, &delegate, expires_at)?;

        // Emit event
        let timestamp = env.ledger().timestamp();

        DelegateAdded {
            package_id,
            recipient: package.recipient.clone(),
            delegate: delegate.clone(),
            actor: admin.clone(),
            expires_at,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Removes the delegate for a package. Called after a successful claim
    /// to prevent any further reassignment. Emits a `DelegateRevoked` event.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must be authenticated)
    /// * `package_id` - Package ID to remove delegate for
    ///
    /// # Errors
    /// - `Error::PackageNotFound` - Package doesn't exist
    pub fn revoke_delegate(env: Env, admin: Address, package_id: u64) -> Result<(), Error> {
        admin.require_auth();

        // Check package exists
        let key = crate::keys::package_key(package_id);
        let package: Package = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PackageNotFound)?;

        // Get the current delegate before removing
        let current_delegate = crate::delegate::get_delegate(&env, package_id);

        // Use the delegate module function
        crate::delegate::clear_delegate(&env, package_id);

        // Emit event if there was a delegate to revoke
        if let Some(delegate) = current_delegate {
            let timestamp = env.ledger().timestamp();

            DelegateRevoked {
                package_id,
                recipient: package.recipient.clone(),
                delegate: delegate.clone(),
                actor: admin.clone(),
                timestamp,
            }
            .publish(&env);
        }

        Ok(())
    }

    /// Gets the current delegate for a package (if any and not expired).
    pub fn get_delegate(env: Env, package_id: u64) -> Option<Address> {
        crate::delegate::get_delegate(&env, package_id)
    }

    /// Gets delegate information including expiration.
    pub fn get_delegate_info(env: Env, package_id: u64) -> Option<(Address, Option<u64>)> {
        crate::delegate::get_delegate_info(&env, package_id)
    }

    /// Gets the delegate history for a package.
    pub fn get_delegate_history(
        env: Env,
        package_id: u64,
    ) -> Vec<crate::delegate::DelegateHistory> {
        crate::delegate::get_delegate_history(&env, package_id)
    }

    // --- Token Allowlist Management ---

    /// Admin-only. Adds a token to the allowed tokens list.
    /// Validates the token contract interface before adding.
    /// Emits a `TokenAdded` event.
    ///
    /// # Arguments
    /// * `token` — Address of the token contract to add.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    /// Returns `Error::InvalidToken` if the token contract is invalid.
    /// Returns `Error::InvalidState` if the token is already in the list.
    pub fn add_allowed_token(env: Env, token: Address) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        // Validate the token contract
        Self::validate_token(&env, &token)?;

        // Read current config
        let mut config = Self::get_config(env.clone());

        // Check if token already in list
        if config.allowed_tokens.contains(token.clone()) {
            return Err(Error::InvalidState);
        }

        // Add the token
        config.allowed_tokens.push_back(token.clone());
        env.storage().instance().set(&KEY_CONFIG, &config);

        // Emit event
        let timestamp = env.ledger().timestamp();
        TokenAdded {
            admin,
            token,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only. Removes a token from the allowed tokens list.
    /// Emits a `TokenRemoved` event.
    ///
    /// # Arguments
    /// * `token` — Address of the token contract to remove.
    ///
    /// # Errors
    /// Returns `Error::NotAuthorized` if caller is not the admin.
    /// Returns `Error::InvalidState` if the token is not in the list.
    pub fn remove_allowed_token(env: Env, token: Address) -> Result<(), Error> {
        let admin = Self::get_admin(env.clone())?;
        admin.require_auth();

        // Read current config
        let mut config = Self::get_config(env.clone());

        // Check if token is not in the list (error)
        let mut found = false;
        let mut new_tokens = Vec::new(&env);
        for i in 0..config.allowed_tokens.len() {
            let t = config.allowed_tokens.get(i).unwrap();
            if t == token {
                found = true;
            } else {
                new_tokens.push_back(t);
            }
        }

        if !found {
            return Err(Error::InvalidState);
        }

        // Update config with new token list
        config.allowed_tokens = new_tokens;
        env.storage().instance().set(&KEY_CONFIG, &config);

        // Emit event
        let timestamp = env.ledger().timestamp();
        TokenRemoved {
            admin,
            token,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    /// Cleanup expired delegates to reclaim storage.
    /// Called periodically or as part of maintenance operations.
    pub fn cleanup_expired_delegates(env: Env, admin: Address) -> Result<u32, Error> {
        admin.require_auth();
        crate::delegate::cleanup_expired_delegates(&env, &admin)
    }

    /// Sweeps expired delegate entries in bounded batches to reclaim storage rent.
    /// Safe to call repeatedly and by any address (no admin auth required).
    /// Emits a `DelegateRevoked` event per cleared delegate.
    pub fn sweep_expired_delegates(env: Env, limit: u32) -> Result<u32, Error> {
        crate::delegate::sweep_expired_delegates(&env, limit)
    }

    /// Sweeps expired packages in bounded batches, transitioning them to the
    /// terminal `Expired` state and releasing their funds from the locked
    /// total (`get_total_locked`) back to the pool.
    ///
    /// Safe to call repeatedly and by any address (no admin auth required)
    /// and idempotent: packages that are not `Created` or not yet past their
    /// `expires_at` are skipped, and a sweep with nothing left to do returns
    /// `0`.
    ///
    /// Emits a `PackageSwept` event per swept package.
    pub fn sweep_expired_packages(env: Env, limit: u32) -> Result<u32, Error> {
        let max_limit = if limit == 0 { 50 } else { limit.min(100) };

        let count: u64 = env.storage().instance().get(&KEY_PKG_IDX).unwrap_or(0);
        let now = env.ledger().timestamp();

        let mut swept_count: u32 = 0;

        for i in 0..count {
            if swept_count >= max_limit {
                break;
            }

            let idx_key = (symbol_short!("pidx"), i);
            let pkg_id: u64 = match env.storage().persistent().get(&idx_key) {
                Some(id) => id,
                None => continue,
            };

            let pkg_key = (symbol_short!("pkg"), pkg_id);
            let mut package: Package = match env.storage().persistent().get(&pkg_key) {
                Some(package) => package,
                None => continue,
            };

            // Only `Created` packages can expire; terminal states are skipped.
            if package.status != PackageStatus::Created {
                continue;
            }

            // Mirror claim/refund expiry semantics: a package is expired only
            // after its `expires_at` has passed (claim at the exact boundary
            // timestamp is still allowed).
            if package.expires_at == 0 || now <= package.expires_at {
                continue;
            }

            // Transition to the terminal Expired state and release the locked
            // funds back to the pool.
            package.status = PackageStatus::Expired;
            env.storage().persistent().set(&pkg_key, &package);

            Self::decrement_locked(&env, &package.token, package.amount);

            PackageSwept {
                package_id: pkg_id,
                recipient: package.recipient.clone(),
                amount: package.amount,
                actor: env.current_contract_address(),
                timestamp: now,
            }
            .publish(&env);

            swept_count += 1;
        }

        Ok(swept_count)
    }
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::{StellarAssetClient, TokenClient};
    use soroban_sdk::{symbol_short, Address, Env, Map};

    fn setup() -> (Env, AidEscrowClient<'static>) {
        let env = Env::default();
        // Set a fixed timestamp to avoid 0-timestamp edge cases
        env.ledger().with_mut(|li| li.timestamp = 1000);

        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        (env, client)
    }

    fn setup_token(
        env: &Env,
        admin: &Address,
    ) -> (Address, StellarAssetClient<'static>, TokenClient<'static>) {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let sac = StellarAssetClient::new(env, &token);
        let token_client = TokenClient::new(env, &token);

        // Standard Stellar Assets in Soroban tests default to 7 decimals.
        // Our test amounts (like 5,000,000) are multiples of 10^6 and 10^7,
        // so they will pass the dynamic check in the refactored fund method.

        (token, sac, token_client)
    }

    #[test]
    fn test_cancel_package() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        // Corrected fund amount (1.0 units)
        let amount = 10_000_000;

        sac.mint(&admin, &20_000_000);
        client.fund(&token, &admin, &amount);

        let package_metadata = Map::new(&env);
        let package_id = client.create_package(
            &admin,
            &1,
            &recipient,
            &10_000_000, // <--- CHANGED THIS from 1_000_000 to 10_000_000
            &token,
            &86400,
            &package_metadata,
        );

        client.cancel_package(&package_id);
        let package = client.get_package(&package_id);
        assert_eq!(package.status, PackageStatus::Cancelled);
    }

    #[test]
    fn test_list_recipient_packages_few_packages() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        // Using multiples of 10^7 (1.0 units) for 7-decimal test tokens
        sac.mint(&admin, &50_000_000);
        client.fund(&token, &admin, &40_000_000);

        let empty_metadata = Map::new(&env);
        client.create_package(
            &admin,
            &1,
            &recipient1,
            &10_000_000,
            &token,
            &86400,
            &empty_metadata,
        );
        client.create_package(
            &admin,
            &2,
            &recipient1,
            &20_000_000,
            &token,
            &86400,
            &empty_metadata,
        );

        let packages = client.list_recipient_packages(&recipient1, &0, &10);
        assert_eq!(packages.len(), 2);
    }

    #[test]
    fn test_list_recipient_packages_pagination() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        sac.mint(&admin, &100_000_000);
        client.fund(&token, &admin, &100_000_000);

        let mut package_ids = soroban_sdk::Vec::new(&env);
        for i in 0..5 {
            package_ids.push_back(client.create_package(
                &admin,
                &(i as u64),
                &recipient,
                &10_000_000,
                &token,
                &86400,
                &Map::new(&env),
            ));
        }

        let page = client.list_recipient_packages(&recipient, &0, &3);
        assert_eq!(page.len(), 3);
    }

    // ---- Pagination acceptance tests (issue #963) ----

    /// Empty result when no packages exist for the recipient.
    #[test]
    fn test_list_recipient_packages_empty() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);

        env.mock_all_auths();
        client.init(&admin);

        // No packages created — expect empty Vec.
        let result = client.list_recipient_packages(&recipient, &0, &10);
        assert_eq!(result.len(), 0);
    }

    /// Single-page retrieval: all packages fit inside one call.
    #[test]
    fn test_list_recipient_packages_single_page() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        sac.mint(&admin, &30_000_000);
        client.fund(&token, &admin, &30_000_000);

        let meta = Map::new(&env);
        for i in 0..3_u64 {
            client.create_package(&admin, &i, &recipient, &10_000_000, &token, &86400, &meta);
        }

        // Request more than available — should return exactly 3.
        let result = client.list_recipient_packages(&recipient, &0, &50);
        assert_eq!(result.len(), 3);
        // Count helper must agree.
        assert_eq!(client.get_recipient_package_count(&recipient), 3);
    }

    /// Multi-page retrieval: iterate through pages and collect all package IDs.
    #[test]
    fn test_list_recipient_packages_multi_page() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        sac.mint(&admin, &70_000_000);
        client.fund(&token, &admin, &70_000_000);

        let meta = Map::new(&env);
        for i in 0..7_u64 {
            client.create_package(&admin, &i, &recipient, &10_000_000, &token, &86400, &meta);
        }

        let total = client.get_recipient_package_count(&recipient);
        assert_eq!(total, 7);

        // Page 1: IDs 0..3
        let page1 = client.list_recipient_packages(&recipient, &0, &3);
        assert_eq!(page1.len(), 3);

        // Page 2: IDs 3..6
        let page2 = client.list_recipient_packages(&recipient, &3, &3);
        assert_eq!(page2.len(), 3);

        // Page 3: ID 6
        let page3 = client.list_recipient_packages(&recipient, &6, &3);
        assert_eq!(page3.len(), 1);

        // All pages together cover all 7 packages.
        assert_eq!(page1.len() + page2.len() + page3.len(), 7);
    }

    /// Out-of-range cursor returns an empty result without panicking.
    #[test]
    fn test_list_recipient_packages_out_of_range_cursor() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        sac.mint(&admin, &10_000_000);
        client.fund(&token, &admin, &10_000_000);

        let meta = Map::new(&env);
        client.create_package(&admin, &0, &recipient, &10_000_000, &token, &86400, &meta);

        // cursor = 999 is way beyond the single package — must return empty.
        let result = client.list_recipient_packages(&recipient, &999, &10);
        assert_eq!(result.len(), 0);
    }

    /// MAX_PAGE_SIZE is enforced: passing a limit larger than MAX_PAGE_SIZE
    /// must not return more than MAX_PAGE_SIZE items.
    #[test]
    fn test_list_recipient_packages_max_page_size_enforced() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        // Create MAX_PAGE_SIZE + 5 packages so a full page is possible.
        let n = (MAX_PAGE_SIZE + 5) as u64;
        let total_amount = n as i128 * 10_000_000;
        sac.mint(&admin, &total_amount);
        client.fund(&token, &admin, &total_amount);

        let meta = Map::new(&env);
        for i in 0..n {
            client.create_package(&admin, &i, &recipient, &10_000_000, &token, &86400, &meta);
        }

        // Requesting more than MAX_PAGE_SIZE must be silently capped.
        let result = client.list_recipient_packages(&recipient, &0, &(MAX_PAGE_SIZE + 100));
        assert!(result.len() <= MAX_PAGE_SIZE);
    }

    #[test]
    fn test_action_specific_pause() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);
        sac.mint(&admin, &20_000_000);
        client.fund(&token, &admin, &10_000_000);

        client.pause_action(&symbol_short!("create"));

        let result = client.try_create_package(
            &admin,
            &99,
            &recipient,
            &10_000_000,
            &token,
            &86400,
            &Map::new(&env),
        );
        assert!(result.is_err());
    }

    #[test]
    fn sweep_expired_packages_releases_locked_funds_in_bounded_batches() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        sac.mint(&admin, &50_000_000);
        client.fund(&token, &admin, &50_000_000);

        let now = env.ledger().timestamp();
        let metadata = Map::new(&env);

        // Package 1 and 2 expire at now + 50; package 3 never expires.
        client.create_package(
            &admin,
            &1,
            &recipient,
            &10_000_000,
            &token,
            &(now + 50),
            &metadata,
        );
        client.create_package(
            &admin,
            &2,
            &recipient,
            &10_000_000,
            &token,
            &(now + 50),
            &metadata,
        );
        client.create_package(&admin, &3, &recipient, &10_000_000, &token, &0, &metadata);

        // All three packages are locked before the sweep.
        assert_eq!(client.get_total_locked(&token), 30_000_000);

        // Advance past the expiry of packages 1 and 2.
        env.ledger().with_mut(|li| li.timestamp = now + 51);

        // Sweep in a bounded batch of 1.
        let swept1 = client.sweep_expired_packages(&1);
        assert_eq!(swept1, 1);
        assert_eq!(client.get_total_locked(&token), 20_000_000);
        assert_eq!(client.get_package(&1).status, PackageStatus::Expired);

        // Sweep the remaining expired package.
        let swept2 = client.sweep_expired_packages(&10);
        assert_eq!(swept2, 1);
        assert_eq!(client.get_total_locked(&token), 10_000_000);
        assert_eq!(client.get_package(&2).status, PackageStatus::Expired);

        // Idempotent: nothing left to sweep.
        assert_eq!(client.sweep_expired_packages(&10), 0);
        assert_eq!(client.get_total_locked(&token), 10_000_000);

        // The never-expiring package is untouched and still locked.
        assert_eq!(client.get_package(&3).status, PackageStatus::Created);
        assert_eq!(client.get_total_locked(&token), 10_000_000);
    }

    #[test]
    fn sweep_expired_packages_skips_packages_at_exact_expiry_boundary() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, sac, _) = setup_token(&env, &admin);

        env.mock_all_auths();
        client.init(&admin);

        sac.mint(&admin, &20_000_000);
        client.fund(&token, &admin, &20_000_000);

        let now = env.ledger().timestamp();
        let metadata = Map::new(&env);
        client.create_package(
            &admin,
            &1,
            &recipient,
            &10_000_000,
            &token,
            &(now + 50),
            &metadata,
        );

        // At the exact expiry boundary the package is still claimable, so the
        // sweep must not touch it yet.
        env.ledger().with_mut(|li| li.timestamp = now + 50);
        assert_eq!(client.sweep_expired_packages(&10), 0);
        assert_eq!(client.get_package(&1).status, PackageStatus::Created);
        assert_eq!(client.get_total_locked(&token), 10_000_000);

        // One second later it is expired and swept.
        env.ledger().with_mut(|li| li.timestamp = now + 51);
        assert_eq!(client.sweep_expired_packages(&10), 1);
        assert_eq!(client.get_package(&1).status, PackageStatus::Expired);
        assert_eq!(client.get_total_locked(&token), 0);
    }
}
