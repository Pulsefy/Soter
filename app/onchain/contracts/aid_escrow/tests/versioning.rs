#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config};
use soroban_sdk::{Address, Env, Vec, testutils::Address as _};

#[test]
fn test_version_set_on_init() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);

    assert_eq!(client.get_version(), 1);
}

#[test]
fn test_migrate_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    client.migrate(&2);

    assert_eq!(client.get_version(), 2);
}

#[test]
fn test_migrate_version_progression() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    assert_eq!(client.get_version(), 1);

    client.migrate(&2);
    assert_eq!(client.get_version(), 2);

    client.migrate(&3);
    assert_eq!(client.get_version(), 3);
}

#[test]
fn test_migrate_preserves_state_across_version_bump() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);

    let config = Config {
        min_amount: 7,
        max_expires_in: 3600,
        allowed_tokens: Vec::from_array(&env, [Address::generate(&env)]),
    };
    client.set_config(&config);
    client.pause();

    client.migrate(&2);

    assert_eq!(client.get_version(), 2);
    assert_eq!(client.get_config(), config);
    assert!(client.is_paused());
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_migrate_rejects_non_sequential_versions_with_clear_error() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);

    let res = client.try_migrate(&3);
    assert!(res.is_err(), "non-sequential migrations should fail loudly");
}
