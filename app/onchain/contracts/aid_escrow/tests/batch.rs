#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    Address, Env, Vec,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
};

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
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
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &10_000);

    // Build recipients and amounts vectors
    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());
    recipients.push_back(recipient3.clone());

    let mut amounts = Vec::new(&env);
    amounts.push_back(1000_i128);
    amounts.push_back(2000_i128);
    amounts.push_back(3000_i128);

    let expires_in = 86400_u64; // 1 day

    // Call batch_create_packages
    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &expires_in,
    );

    // Verify returned IDs are sequential starting from 0
    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(ids.get(1).unwrap(), 1);
    assert_eq!(ids.get(2).unwrap(), 2);

    // Verify each package
    let pkg0 = client.get_package(&0);
    assert_eq!(pkg0.recipient, recipient1);
    assert_eq!(pkg0.amount, 1000);
    assert_eq!(pkg0.status, PackageStatus::Created);

    let pkg1 = client.get_package(&1);
    assert_eq!(pkg1.recipient, recipient2);
    assert_eq!(pkg1.amount, 2000);
    assert_eq!(pkg1.status, PackageStatus::Created);

    let pkg2 = client.get_package(&2);
    assert_eq!(pkg2.recipient, recipient3);
    assert_eq!(pkg2.amount, 3000);
    assert_eq!(pkg2.status, PackageStatus::Created);

    // Verify contract balance hasn't changed (funds are locked, not transferred)
    assert_eq!(token_client.balance(&contract_id), 10_000);
}

#[test]
fn test_batch_create_packages_mismatched_arrays() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // 2 recipients but 3 amounts
    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1);
    recipients.push_back(recipient2);

    let mut amounts = Vec::new(&env);
    amounts.push_back(1000_i128);
    amounts.push_back(2000_i128);
    amounts.push_back(3000_i128);

    let result = client.try_batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
    );
    assert_eq!(result, Err(Ok(Error::MismatchedArrays)));
}

#[test]
fn test_batch_create_packages_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Second amount is 0 (invalid)
    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1);
    recipients.push_back(recipient2);

    let mut amounts = Vec::new(&env);
    amounts.push_back(1000_i128);
    amounts.push_back(0_i128);

    let result = client.try_batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
    );
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_batch_create_packages_insufficient_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &1000); // Only 1000 funded

    // Total amounts = 1500 > 1000 available
    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1);
    recipients.push_back(recipient2);

    let mut amounts = Vec::new(&env);
    amounts.push_back(800_i128);
    amounts.push_back(700_i128);

    let result = client.try_batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
    );
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

#[test]
fn test_batch_create_packages_empty_arrays() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let recipients: Vec<Address> = Vec::new(&env);
    let amounts: Vec<i128> = Vec::new(&env);

    let ids =
        client.batch_create_packages(&admin, &recipients, &amounts, &token_client.address, &86400);
    assert_eq!(ids.len(), 0);
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
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &10_000);

    // Batch create 2 packages (IDs 0, 1)
    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());

    let mut amounts = Vec::new(&env);
    amounts.push_back(1000_i128);
    amounts.push_back(1000_i128);

    let ids =
        client.batch_create_packages(&admin, &recipients, &amounts, &token_client.address, &86400);
    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(ids.get(1).unwrap(), 1);

    // Now create an individual package with a manual ID that doesn't collide
    let manual_id = 100; // explicitly different from batch-assigned IDs
    let expiry = env.ledger().timestamp() + 86400;
    client.create_package(
        &admin,
        &manual_id,
        &recipient3,
        &1000,
        &token_client.address,
        &expiry,
    );

    let pkg = client.get_package(&manual_id);
    assert_eq!(pkg.recipient, recipient3);

    // Verify batch packages are still intact
    let pkg0 = client.get_package(&0);
    assert_eq!(pkg0.recipient, recipient1);
    let pkg1 = client.get_package(&1);
    assert_eq!(pkg1.recipient, recipient2);
}
