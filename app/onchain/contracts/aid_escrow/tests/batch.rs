#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Vec,
};

const UNIT: i128 = 10_000_000; // 1.0 Token for 7-decimal assets

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

fn empty_metadata(env: &Env, count: u32) -> Vec<Map<soroban_sdk::Symbol, soroban_sdk::String>> {
    let mut metadatas = Vec::new(env);
    for _ in 0..count {
        metadatas.push_back(Map::new(env));
    }
    metadatas
}

#[test]
fn test_batch_create_packages_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let recipient3 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    // Mint and fund 10.0 tokens
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());
    recipients.push_back(recipient3.clone());

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT); // 1.0
    amounts.push_back(2 * UNIT); // 2.0
    amounts.push_back(3 * UNIT); // 3.0

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 3),
    );

    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(client.get_package(&0).recipient, recipient1);
}

#[test]
fn test_batch_create_packages_insufficient_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    // Fund with exactly 1.0 token
    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let mut recipients = Vec::new(&env);
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT); // Uses the full 1.0 token
    amounts.push_back(UNIT); // Needs another 1.0 token (Insufficient)

    let result = client.try_batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 2),
    );

    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

#[test]
fn test_batch_then_individual_no_id_collision() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let recipient3 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &(5 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);
    amounts.push_back(UNIT);

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 2),
    );

    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(ids.get(1).unwrap(), 1);

    let manual_id = 100;
    let expiry = env.ledger().timestamp() + 86400;
    client.create_package(
        &admin,
        &manual_id,
        &recipient3,
        &UNIT,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );

    assert_eq!(client.get_package(&manual_id).recipient, recipient3);
}

#[test]
fn test_batch_create_packages_mismatched_arrays() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, _) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    let mut recipients = Vec::new(&env);
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT); // Only 1 amount for 2 recipients

    let result = client.try_batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 2),
    );
    assert_eq!(result, Err(Ok(Error::MismatchedArrays)));
}

#[test]
fn test_batch_create_packages_empty_arrays() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, _) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    let recipients: Vec<Address> = Vec::new(&env);
    let amounts: Vec<i128> = Vec::new(&env);

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &Vec::new(&env),
    );
    assert_eq!(ids.len(), 0);
}
