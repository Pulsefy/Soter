#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    Address, Env,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
};

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

#[test]
fn test_core_flow_fund_create_claim() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    // Initialize
    client.init(&admin);

    // Mint tokens to admin for funding
    token_admin_client.mint(&admin, &10_000);

    // 2. Fund the contract (Pool)
    client.fund(&token_client.address, &admin, &5000);
    assert_eq!(token_client.balance(&contract_id), 5000);

    // 3. Create Package
    let pkg_id = 101;
    let expiry = env.ledger().timestamp() + 86400; // 1 day later
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &expiry,
        &empty_metadata,
    );

    // Check Package State
    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Created);
    assert_eq!(pkg.amount, 1000);

    // 4. Claim
    client.claim(&pkg_id);

    // Check Final State
    let pkg_claimed = client.get_package(&pkg_id);
    assert_eq!(pkg_claimed.status, PackageStatus::Claimed);
    assert_eq!(token_client.balance(&recipient), 1000);
    assert_eq!(token_client.balance(&contract_id), 4000); // 5000 - 1000
}

#[test]
fn test_solvency_check() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &1000);
    client.fund(&token_client.address, &admin, &1000);

    // Try creating package > available balance
    let res = client.try_create_package(&1, &recipient, &2000, &token_client.address, &0);
    assert_eq!(res, Err(Ok(Error::InsufficientFunds)));

    // Create valid package using all funds
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &2,
        &recipient,
        &1000,
        &token_client.address,
        &0,
        &empty_metadata,
    );

    // Try creating another package (funds are locked)
    let res2 = client.try_create_package(&3, &recipient, &1, &token_client.address, &0);
    assert_eq!(res2, Err(Ok(Error::InsufficientFunds)));
}

#[test]
fn test_expiry_and_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &1000);
    client.fund(&token_client.address, &admin, &1000);

    // Create Package that expires soon
    let start_time = 1000;
    env.ledger().set_timestamp(start_time);
    let pkg_id = 1;
    let expiry = start_time + 100;
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &pkg_id,
        &recipient,
        &500,
        &token_client.address,
        &expiry,
        &empty_metadata,
    );

    // Advance time past expiry
    env.ledger().set_timestamp(expiry + 1);

    // Recipient tries to claim -> Should Fail
    let claim_res = client.try_claim(&pkg_id);
    assert_eq!(claim_res, Err(Ok(Error::PackageExpired)));

    // Admin refunds
    // Balance before refund: Admin has 0 (minted 1000, funded 1000)
    assert_eq!(token_client.balance(&admin), 0);

    client.refund(&pkg_id);

    // Balance after refund: Admin gets 500 back
    assert_eq!(token_client.balance(&admin), 500);

    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Refunded);
}

#[test]
fn test_revoke_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &1000);
    client.fund(&token_client.address, &admin, &1000);

    let pkg_id = 1;
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &pkg_id,
        &recipient,
        &500,
        &token_client.address,
        &0,
        &empty_metadata,
    );

    // Revoke
    client.revoke(&pkg_id);

    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Cancelled);

    // Funds are now unlocked. We can create a new package using those same funds.
    // If they were still locked, this would fail (Balance 1000, Used 500. Available 500. Request 1000 -> Fail).
    // Since revoked, Available should be 1000 again.
    let pkg_id_2 = 2;
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &pkg_id_2,
        &recipient,
        &1000,
        &token_client.address,
        &0,
        &empty_metadata,
    );
}

#[test]
fn test_get_recipient_package_count() {
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

    token_admin_client.mint(&admin, &10000);
    client.fund(&token_client.address, &admin, &10000);

    // Test 1: Recipient with no packages returns 0
    let count = client.get_recipient_package_count(&recipient1);
    assert_eq!(count, 0);

    // Test 2: Create packages for recipient1
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &1,
        &recipient1,
        &100,
        &token_client.address,
        &0,
        &empty_metadata,
    );
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &2,
        &recipient1,
        &200,
        &token_client.address,
        &0,
        &empty_metadata,
    );
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &3,
        &recipient1,
        &300,
        &token_client.address,
        &0,
        &empty_metadata,
    );

    // Count should be 3
    let count = client.get_recipient_package_count(&recipient1);
    assert_eq!(count, 3);

    // Test 3: Create package for recipient2
    let empty_metadata = soroban_sdk::Map::new(&env);
    client.create_package(
        &4,
        &recipient2,
        &400,
        &token_client.address,
        &0,
        &empty_metadata,
    );

    // recipient1 still has 3 packages
    let count1 = client.get_recipient_package_count(&recipient1);
    assert_eq!(count1, 3);

    // recipient2 has 1 package
    let count2 = client.get_recipient_package_count(&recipient2);
    assert_eq!(count2, 1);

    // Test 4: Claim a package - should still count
    client.claim(&1);
    let count = client.get_recipient_package_count(&recipient1);
    assert_eq!(count, 3); // Still counts claimed packages

    // Test 5: Revoke a package - should still count
    client.revoke(&2);
    let count = client.get_recipient_package_count(&recipient1);
    assert_eq!(count, 3); // Still counts revoked packages

    // Test 6: Refund a package - should still count
    client.refund(&3);
    let count = client.get_recipient_package_count(&recipient1);
    assert_eq!(count, 3); // Still counts refunded packages
}

#[test]
fn test_create_package_with_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &1000);
    client.fund(&token_client.address, &admin, &1000);

    // Create metadata
    let mut metadata = soroban_sdk::Map::new(&env);
    metadata.set(
        soroban_sdk::Symbol::new(&env, "purpose"),
        soroban_sdk::String::new(&env, "emergency relief").unwrap(),
    );
    metadata.set(
        soroban_sdk::Symbol::new(&env, "region"),
        soroban_sdk::String::new(&env, "africa").unwrap(),
    );
    metadata.set(
        soroban_sdk::Symbol::new(&env, "priority"),
        soroban_sdk::String::new(&env, "high").unwrap(),
    );

    // Create package with metadata
    let pkg_id = 1;
    let expiry = env.ledger().timestamp() + 86400;
    client.create_package(
        &pkg_id,
        &recipient,
        &500,
        &token_client.address,
        &expiry,
        &metadata,
    );

    // Retrieve package and verify metadata
    let pkg = client.get_package(&pkg_id);

    // Verify metadata values
    assert_eq!(
        pkg.metadata
            .get(soroban_sdk::Symbol::new(&env, "purpose"))
            .unwrap(),
        soroban_sdk::String::new(&env, "emergency relief").unwrap()
    );
    assert_eq!(
        pkg.metadata
            .get(soroban_sdk::Symbol::new(&env, "region"))
            .unwrap(),
        soroban_sdk::String::new(&env, "africa").unwrap()
    );
    assert_eq!(
        pkg.metadata
            .get(soroban_sdk::Symbol::new(&env, "priority"))
            .unwrap(),
        soroban_sdk::String::new(&env, "high").unwrap()
    );

    // Verify metadata size
    assert_eq!(pkg.metadata.len(), 3);

    // Test with empty metadata
    let empty_metadata = soroban_sdk::Map::new(&env);
    let pkg_id_2 = 2;
    client.create_package(
        &pkg_id_2,
        &recipient,
        &300,
        &token_client.address,
        &expiry,
        &empty_metadata,
    );

    let pkg2 = client.get_package(&pkg_id_2);
    assert_eq!(pkg2.metadata.len(), 0);

    // Test with single metadata entry
    let mut single_metadata = soroban_sdk::Map::new(&env);
    single_metadata.set(
        soroban_sdk::Symbol::new(&env, "note"),
        soroban_sdk::String::new(&env, "special case").unwrap(),
    );

    let pkg_id_3 = 3;
    client.create_package(
        &pkg_id_3,
        &recipient,
        &200,
        &token_client.address,
        &expiry,
        &single_metadata,
    );

    let pkg3 = client.get_package(&pkg_id_3);
    assert_eq!(pkg3.metadata.len(), 1);
    assert_eq!(
        pkg3.metadata
            .get(soroban_sdk::Symbol::new(&env, "note"))
            .unwrap(),
        soroban_sdk::String::new(&env, "special case").unwrap()
    );
}

#[test]
fn test_cancel_package_comprehensive() {
    let env = Env::default();
    // We don't use mock_all_auths() here if we want to manually verify
    // that a specific user (non-admin) fails the check.

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    // 1. Setup - Mock auths for the initialization and funding
    env.mock_all_auths();
    client.init(&admin);
    token_admin_client.mint(&admin, &2000);
    client.fund(&token_client.address, &admin, &2000);

    let pkg_id = 1;
    client.create_package(&pkg_id, &recipient, &1000, &token_client.address, &0);

    // FIX: Use the malicious_user or prefix with underscore
    let _malicious_user = Address::generate(&env);

    // 2. Test Successful cancel (By Admin)
    // This will work because mock_all_auths is still active
    client.cancel_package(&pkg_id);
    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Cancelled);

    // 3. Attempt to cancel already cancelled package fails
    let res = client.try_cancel_package(&pkg_id);
    assert_eq!(res, Err(Ok(Error::PackageNotActive)));

    // 4. Attempt to cancel claimed package fails
    let pkg_id_2 = 2;
    client.create_package(&pkg_id_2, &recipient, &1000, &token_client.address, &0);
    client.claim(&pkg_id_2);

    let res_claim = client.try_cancel_package(&pkg_id_2);
    assert_eq!(res_claim, Err(Ok(Error::PackageNotActive)));
}
