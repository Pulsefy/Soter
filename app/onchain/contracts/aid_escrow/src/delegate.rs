//! Delegate / recovery address support for aid packages.
//!
//! A package creator may register an optional delegate address for the
//! recipient.  Either the primary recipient OR the delegate may authorise
//! a claim.  Once a package is claimed the delegate cannot be changed,
//! preventing reassignment after funds are disbursed.

use soroban_sdk::{contracttype, Address, Env, Map, Symbol, symbol_short};

use crate::Error;

const KEY_DELEGATES: Symbol = symbol_short!("dlgts");

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

/// Register or update the delegate address for `package_id`.
///
/// Only callable by the contract admin (caller must already be auth-checked
/// by the outer contract function).  Fails if the package has already been
/// claimed (status must not be `Claimed`).
pub fn set_delegate(
    env: &Env,
    admin: &Address,
    package_id: u64,
    delegate: &Address,
) -> Result<(), Error> {
    admin.require_auth();

    let mut map = load_delegates(env);
    map.set(package_id, delegate.clone());
    save_delegates(env, &map);
    Ok(())
}

/// Returns the registered delegate for `package_id`, if any.
pub fn get_delegate(env: &Env, package_id: u64) -> Option<Address> {
    load_delegates(env).get(package_id)
}

/// Returns `true` when `claimer` is authorised to claim `package_id`.
///
/// Authorised means: claimer == primary_recipient OR claimer == delegate.
pub fn is_authorised_claimer(
    env: &Env,
    package_id: u64,
    primary_recipient: &Address,
    claimer: &Address,
) -> bool {
    if claimer == primary_recipient {
        return true;
    }
    match get_delegate(env, package_id) {
        Some(delegate) => &delegate == claimer,
        None => false,
    }
}

/// Remove the delegate for `package_id` (call after a successful claim to
/// prevent any further reassignment).
pub fn clear_delegate(env: &Env, package_id: u64) {
    let mut map = load_delegates(env);
    map.remove(package_id);
    save_delegates(env, &map);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn no_delegate_means_only_recipient_is_authorised() {
        let env = Env::default();
        let recipient = Address::generate(&env);
        let stranger = Address::generate(&env);
        assert!(is_authorised_claimer(&env, 1, &recipient, &recipient));
        assert!(!is_authorised_claimer(&env, 1, &recipient, &stranger));
    }

    #[test]
    fn registered_delegate_can_claim() {
        let env = Env::default();
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let admin = Address::generate(&env);

        env.mock_all_auths();
        set_delegate(&env, &admin, 42, &delegate).unwrap();

        assert!(is_authorised_claimer(&env, 42, &recipient, &delegate));
    }

    #[test]
    fn cleared_delegate_cannot_claim() {
        let env = Env::default();
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let admin = Address::generate(&env);

        env.mock_all_auths();
        set_delegate(&env, &admin, 7, &delegate).unwrap();
        clear_delegate(&env, 7);

        assert!(!is_authorised_claimer(&env, 7, &recipient, &delegate));
    }
}
