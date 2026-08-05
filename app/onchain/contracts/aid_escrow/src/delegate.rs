//! Delegate / recovery address support for aid packages.
//!
//! A package creator may register an optional delegate address for the
//! recipient.  Either the primary recipient OR the delegate may authorise
//! a claim.  Once a package is claimed the delegate cannot be changed,
//! preventing reassignment after funds are disbursed.
//!
//! Enhanced features:
//! - Delegate expiration support
//! - Package status validation
//! - Audit trail for delegate changes
//! - Optimized storage operations
//! - Comprehensive error handling

use soroban_sdk::{contracttype, symbol_short, Address, Env, Map, Symbol, Vec};

use crate::{Error, PackageStatus};

pub const KEY_DELEGATES: Symbol = symbol_short!("dlgts");
pub const KEY_DELEGATE_HISTORY: Symbol = symbol_short!("dlgh");
pub const KEY_DELEGATE_EXPIRY: Symbol = symbol_short!("dlgexp");

#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegateHistory {
    pub package_id: u64,
    pub previous_delegate: Option<Address>,
    pub new_delegate: Address,
    pub changed_by: Address,
    pub changed_at: u64,
    pub reason: Symbol,
}

/// Loads the full delegate map from persistent storage.
fn load_delegates(env: &Env) -> Map<u64, Address> {
    env.storage()
        .persistent()
        .get(&KEY_DELEGATES)
        .unwrap_or_else(|| Map::new(env))
}

/// Persists the delegate map.
fn save_delegates(env: &Env, map: &Map<u64, Address>) {
    env.storage().persistent().set(&KEY_DELEGATES, map);
}

/// Loads delegate expiry information.
fn load_delegate_expiry(env: &Env) -> Map<u64, u64> {
    env.storage()
        .persistent()
        .get(&KEY_DELEGATE_EXPIRY)
        .unwrap_or_else(|| Map::new(env))
}

/// Persists delegate expiry information.
fn save_delegate_expiry(env: &Env, map: &Map<u64, u64>) {
    env.storage().persistent().set(&KEY_DELEGATE_EXPIRY, map);
}

/// Loads delegate history for audit trail.
fn load_delegate_history(env: &Env) -> Vec<DelegateHistory> {
    env.storage()
        .persistent()
        .get(&KEY_DELEGATE_HISTORY)
        .unwrap_or_else(|| Vec::new(env))
}

/// Persists delegate history.
fn save_delegate_history(env: &Env, history: &Vec<DelegateHistory>) {
    env.storage()
        .persistent()
        .set(&KEY_DELEGATE_HISTORY, history);
}

/// Checks if a delegate has expired.
fn is_delegate_expired(env: &Env, package_id: u64) -> bool {
    let expiry_map = load_delegate_expiry(env);
    if let Some(expires_at) = expiry_map.get(package_id) {
        expires_at > 0 && env.ledger().timestamp() > expires_at
    } else {
        false
    }
}

/// Validates that a package exists and is in a valid state for delegate operations.
fn validate_package_state(env: &Env, package_id: u64) -> Result<(), Error> {
    let package_key = (symbol_short!("pkg"), package_id);
    if !env.storage().persistent().has(&package_key) {
        return Err(Error::PackageNotFound);
    }

    let package: crate::Package = env.storage().persistent().get(&package_key).unwrap();

    // Cannot modify delegates for claimed packages
    if package.status == PackageStatus::Claimed {
        return Err(Error::PackageNotActive);
    }

    Ok(())
}

/// Records delegate change in history for audit trail.
fn record_delegate_change(
    env: &Env,
    package_id: u64,
    previous_delegate: Option<Address>,
    new_delegate: &Address,
    changed_by: &Address,
    reason: Symbol,
) {
    let mut history = load_delegate_history(env);
    let record = DelegateHistory {
        package_id,
        previous_delegate,
        new_delegate: new_delegate.clone(),
        changed_by: changed_by.clone(),
        changed_at: env.ledger().timestamp(),
        reason,
    };
    history.push_back(record);
    save_delegate_history(env, &history);
}

/// Records delegate change in history for audit trail (system version).
fn record_delegate_change_system(
    env: &Env,
    package_id: u64,
    previous_delegate: Option<Address>,
    new_delegate: &Address,
    reason: Symbol,
) {
    let mut history = load_delegate_history(env);
    let record = DelegateHistory {
        package_id,
        previous_delegate,
        new_delegate: new_delegate.clone(),
        changed_by: env.current_contract_address(), // System uses contract address as placeholder
        changed_at: env.ledger().timestamp(),
        reason,
    };
    history.push_back(record);
    save_delegate_history(env, &history);
}

/// Register or update the delegate address for `package_id`.
///
/// Only callable by the contract admin (caller must already be auth-checked
/// by the outer contract function).  Fails if the package has already been
/// claimed (status must not be `Claimed`).
///
/// # Errors
/// - `Error::PackageNotFound` - Package doesn't exist
/// - `Error::PackageNotActive` - Package already claimed
/// - `Error::InvalidState` - Delegate cannot be set to recipient address
pub fn set_delegate(
    env: &Env,
    admin: &Address,
    package_id: u64,
    delegate: &Address,
) -> Result<(), Error> {
    // Admin auth is done by contract entry point

    // Validate package state
    validate_package_state(env, package_id)?;

    // Get package to validate delegate is not the recipient
    let package_key = (symbol_short!("pkg"), package_id);
    let package: crate::Package = env.storage().persistent().get(&package_key).unwrap();

    // Prevent setting delegate to the same address as recipient
    if delegate == &package.recipient {
        return Err(Error::InvalidState);
    }

    let mut map = load_delegates(env);
    let previous_delegate = map.get(package_id);

    map.set(package_id, delegate.clone());
    save_delegates(env, &map);

    // Record the change in history
    record_delegate_change(
        env,
        package_id,
        previous_delegate,
        delegate,
        admin,
        Symbol::new(env, "delegate_set"),
    );

    Ok(())
}

/// Register or update the delegate address for `package_id` with expiration.
///
/// Enhanced version that supports delegate expiration.
///
/// # Arguments
/// - `env` - Contract environment
/// - `admin` - Admin address (must be authenticated)
/// - `package_id` - Package ID to set delegate for
/// - `delegate` - Delegate address
/// - `expires_at` - Optional expiration timestamp (0 = no expiration)
///
/// # Errors
/// - `Error::PackageNotFound` - Package doesn't exist
/// - `Error::PackageNotActive` - Package already claimed
/// - `Error::InvalidState` - Invalid delegate address or expiration
pub fn set_delegate_with_expiry(
    env: &Env,
    admin: &Address,
    package_id: u64,
    delegate: &Address,
    expires_at: u64,
) -> Result<(), Error> {
    // Validate expiration time
    if expires_at > 0 && expires_at <= env.ledger().timestamp() {
        return Err(Error::InvalidState);
    }

    // Set the delegate
    set_delegate(env, admin, package_id, delegate)?;

    // Set expiration if provided
    if expires_at > 0 {
        let mut expiry_map = load_delegate_expiry(env);
        expiry_map.set(package_id, expires_at);
        save_delegate_expiry(env, &expiry_map);
    }

    Ok(())
}

/// Returns the registered delegate for `package_id`, if any.
/// Returns None if no delegate is set or if the delegate has expired.
pub fn get_delegate(env: &Env, package_id: u64) -> Option<Address> {
    // Check if delegate exists
    let delegate = load_delegates(env).get(package_id)?;

    // Check if delegate has expired
    if is_delegate_expired(env, package_id) {
        return None;
    }

    Some(delegate)
}

/// Returns the delegate information including expiration.
pub fn get_delegate_info(env: &Env, package_id: u64) -> Option<(Address, Option<u64>)> {
    let delegate = load_delegates(env).get(package_id)?;
    let expiry_map = load_delegate_expiry(env);
    let expires_at = expiry_map.get(package_id);

    Some((delegate, expires_at))
}

/// Returns the delegate history for a package.
pub fn get_delegate_history(env: &Env, package_id: u64) -> Vec<DelegateHistory> {
    let all_history = load_delegate_history(env);
    let mut package_history = Vec::new(env);

    for record in all_history.iter() {
        if record.package_id == package_id {
            package_history.push_back(record.clone());
        }
    }

    package_history
}

/// Returns `true` when `claimer` is authorised to claim `package_id`.
///
/// Authorised means: claimer == primary_recipient OR claimer == delegate (and not expired).
#[allow(dead_code)]
pub fn is_authorised_claimer(
    env: &Env,
    package_id: u64,
    primary_recipient: &Address,
    claimer: &Address,
) -> bool {
    // Primary recipient is always authorized
    if claimer == primary_recipient {
        return true;
    }

    // Check delegate (includes expiration check)
    match get_delegate(env, package_id) {
        Some(delegate) => &delegate == claimer,
        None => false,
    }
}

/// Returns detailed authorization information for debugging/auditing.
#[allow(dead_code)]
pub fn get_authorization_info(
    env: &Env,
    package_id: u64,
    primary_recipient: &Address,
    claimer: &Address,
) -> (bool, Option<Symbol>) {
    // Check if claimer is primary recipient
    if claimer == primary_recipient {
        return (true, Some(Symbol::new(env, "primary_recipient")));
    }

    // Check delegate status
    let delegate_info = get_delegate_info(env, package_id);
    match delegate_info {
        Some((delegate, expires_at)) => {
            if &delegate == claimer {
                if let Some(expiry) = expires_at {
                    if expiry > env.ledger().timestamp() {
                        (true, Some(Symbol::new(env, "delegate_with_expiry")))
                    } else {
                        (false, Some(Symbol::new(env, "delegate_expired")))
                    }
                } else {
                    (true, Some(Symbol::new(env, "delegate_no_expiry")))
                }
            } else {
                (false, Some(Symbol::new(env, "not_registered_delegate")))
            }
        }
        None => (false, Some(Symbol::new(env, "no_delegate_registered"))),
    }
}

/// Remove the delegate for `package_id` (call after a successful claim to
/// prevent any further reassignment).
pub fn clear_delegate(env: &Env, package_id: u64) {
    let mut map = load_delegates(env);
    let previous_delegate = map.get(package_id);

    map.remove(package_id);
    save_delegates(env, &map);

    // Also clear expiration
    let mut expiry_map = load_delegate_expiry(env);
    expiry_map.remove(package_id);
    save_delegate_expiry(env, &expiry_map);

    // Record the removal in history if there was a delegate
    if let Some(delegate) = previous_delegate {
        record_delegate_change_system(
            env,
            package_id,
            Some(delegate),
            &env.current_contract_address(),
            Symbol::new(env, "delegate_cleared"),
        );
    }
}

/// Cleanup expired delegates to reclaim storage.
/// This should be called periodically or as part of maintenance operations.
#[allow(dead_code)]
pub fn cleanup_expired_delegates(env: &Env, _caller: &Address) -> Result<u32, Error> {
    // Authentication is enforced by the calling contract entry point.

    let mut delegate_map = load_delegates(env);
    let mut expiry_map = load_delegate_expiry(env);
    let mut cleaned_count = 0u32;
    let now = env.ledger().timestamp();

    // Collect expired delegate IDs first to avoid modifying map during iteration
    let mut expired_ids = Vec::new(env);
    for (package_id, expires_at) in expiry_map.iter() {
        if expires_at > 0 && now > expires_at {
            expired_ids.push_back(package_id);
        }
    }

    // Remove expired delegates
    for package_id in expired_ids.iter() {
        delegate_map.remove(package_id);
        expiry_map.remove(package_id);
        cleaned_count += 1;
    }

    // Save changes
    save_delegates(env, &delegate_map);
    save_delegate_expiry(env, &expiry_map);

    Ok(cleaned_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Package, PackageStatus};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Address, Env,
    };

    fn setup() -> (Env, Address) {
        let env = Env::default();
        let contract = env.register(crate::AidEscrow, ());
        (env, contract)
    }

    fn create_test_package(
        env: &Env,
        contract: &Address,
        package_id: u64,
        recipient: &Address,
        status: PackageStatus,
    ) {
        let package = Package {
            id: package_id,
            recipient: recipient.clone(),
            amount: 1000,
            token: Address::generate(env),
            status,
            created_at: env.ledger().timestamp(),
            expires_at: 0,
            claim_starts_at: env.ledger().timestamp(),
            metadata: soroban_sdk::Map::new(env),
        };
        env.as_contract(contract, || {
            env.storage()
                .persistent()
                .set(&(symbol_short!("pkg"), package_id), &package);
        });
    }

    #[test]
    fn no_delegate_means_only_recipient_is_authorised() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let stranger = Address::generate(&env);
        env.as_contract(&contract, || {
            assert!(is_authorised_claimer(&env, 1, &recipient, &recipient));
            assert!(!is_authorised_claimer(&env, 1, &recipient, &stranger));
        });
    }

    #[test]
    fn registered_delegate_can_claim() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let admin = Address::generate(&env);

        create_test_package(&env, &contract, 42, &recipient, PackageStatus::Created);
        env.mock_all_auths();
        env.as_contract(&contract, || {
            set_delegate(&env, &admin, 42, &delegate).unwrap();
            assert!(is_authorised_claimer(&env, 42, &recipient, &delegate));
        });
    }

    #[test]
    fn cleared_delegate_cannot_claim() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let admin = Address::generate(&env);

        create_test_package(&env, &contract, 7, &recipient, PackageStatus::Created);
        env.mock_all_auths();
        env.as_contract(&contract, || {
            set_delegate(&env, &admin, 7, &delegate).unwrap();
            clear_delegate(&env, 7);
            assert!(!is_authorised_claimer(&env, 7, &recipient, &delegate));
        });
    }

    #[test]
    fn delegate_expires_correctly() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let admin = Address::generate(&env);
        let now = 1000u64;

        env.ledger().with_mut(|li| li.timestamp = now);
        create_test_package(&env, &contract, 1, &recipient, PackageStatus::Created);

        env.mock_all_auths();
        env.as_contract(&contract, || {
            set_delegate_with_expiry(&env, &admin, 1, &delegate, now + 100).unwrap();

            assert!(is_authorised_claimer(&env, 1, &recipient, &delegate));
        });

        env.ledger().with_mut(|li| li.timestamp = now + 200);

        env.as_contract(&contract, || {
            assert!(!is_authorised_claimer(&env, 1, &recipient, &delegate));
            assert_eq!(get_delegate(&env, 1), None);
        });
    }

    #[test]
    fn cannot_set_delegate_for_claimed_package() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let admin = Address::generate(&env);

        create_test_package(&env, &contract, 1, &recipient, PackageStatus::Claimed);
        env.mock_all_auths();

        let result = env.as_contract(&contract, || set_delegate(&env, &admin, 1, &delegate));
        assert_eq!(result, Err(Error::PackageNotActive));
    }

    #[test]
    fn cannot_set_delegate_to_recipient_address() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let admin = Address::generate(&env);

        create_test_package(&env, &contract, 1, &recipient, PackageStatus::Created);
        env.mock_all_auths();

        let result = env.as_contract(&contract, || set_delegate(&env, &admin, 1, &recipient));
        assert_eq!(result, Err(Error::InvalidState));
    }

    #[test]
    fn delegate_history_tracking() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let delegate1 = Address::generate(&env);
        let delegate2 = Address::generate(&env);
        let admin = Address::generate(&env);

        create_test_package(&env, &contract, 1, &recipient, PackageStatus::Created);
        env.mock_all_auths();

        env.as_contract(&contract, || {
            set_delegate(&env, &admin, 1, &delegate1).unwrap();
            set_delegate(&env, &admin, 1, &delegate2).unwrap();

            let history = get_delegate_history(&env, 1);
            assert_eq!(history.len(), 2);

            let first_record = history.get(0).unwrap();
            assert_eq!(first_record.previous_delegate, None);
            assert_eq!(first_record.new_delegate, delegate1);

            let second_record = history.get(1).unwrap();
            assert_eq!(second_record.previous_delegate, Some(delegate1));
            assert_eq!(second_record.new_delegate, delegate2);
        });
    }

    #[test]
    fn authorization_info_provides_details() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let stranger = Address::generate(&env);
        let admin = Address::generate(&env);
        let now = 1000u64;

        create_test_package(&env, &contract, 1, &recipient, PackageStatus::Created);
        env.ledger().with_mut(|li| li.timestamp = now);
        env.mock_all_auths();
        env.as_contract(&contract, || {
            set_delegate_with_expiry(&env, &admin, 1, &delegate, now + 100).unwrap();

            let (authorized, reason) = get_authorization_info(&env, 1, &recipient, &recipient);
            assert!(authorized);
            assert_eq!(reason, Some(Symbol::new(&env, "primary_recipient")));

            let (authorized, reason) = get_authorization_info(&env, 1, &recipient, &delegate);
            assert!(authorized);
            let reason_str = reason.unwrap();
            assert!(
                reason_str == Symbol::new(&env, "delegate_with_expiry")
                    || reason_str == Symbol::new(&env, "delegate_no_expiry")
            );

            let (authorized, reason) = get_authorization_info(&env, 1, &recipient, &stranger);
            assert!(!authorized);
            assert_eq!(reason, Some(Symbol::new(&env, "not_registered_delegate")));
        });
    }

    #[test]
    fn cleanup_expired_delegates_works() {
        let (env, contract) = setup();
        let recipient = Address::generate(&env);
        let delegate1 = Address::generate(&env);
        let delegate2 = Address::generate(&env);
        let admin = Address::generate(&env);
        let now = 1000u64;

        create_test_package(&env, &contract, 1, &recipient, PackageStatus::Created);
        create_test_package(&env, &contract, 2, &recipient, PackageStatus::Created);

        env.ledger().with_mut(|li| li.timestamp = now);
        env.mock_all_auths();

        env.as_contract(&contract, || {
            set_delegate_with_expiry(&env, &admin, 1, &delegate1, now + 50).unwrap();
            set_delegate_with_expiry(&env, &admin, 2, &delegate2, now + 200).unwrap();
        });

        env.ledger().with_mut(|li| li.timestamp = now + 100);

        let cleaned = env
            .as_contract(&contract, || cleanup_expired_delegates(&env, &admin))
            .unwrap();
        assert_eq!(cleaned, 1);

        env.as_contract(&contract, || {
            assert_eq!(get_delegate(&env, 1), None);
            assert_eq!(get_delegate(&env, 2), Some(delegate2));
        });
    }
}
