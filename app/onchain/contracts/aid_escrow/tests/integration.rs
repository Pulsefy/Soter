#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{Env, Address};
use soroban_sdk::{
    Address, Env,
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
fn test_integration_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    // Initialize contract
    client.init(&admin);
    assert_eq!(client.get_admin(), admin);
    
    // 2. Create package (admin auth required)
    env.mock_all_auths();
    let package_id = client.create_package(&recipient, &1000, &token, &86400).unwrap();
    assert_eq!(package_id, 0);
    
    // 3. Verify package details
    // get_package returns: (recipient, amount, token, status, created_at, expires_at)
    let package = client.get_package(&package_id).unwrap().unwrap();
    assert_eq!(package.0, recipient);  // recipient
    assert_eq!(package.1, 1000);       // amount
    assert_eq!(package.2, token);      // token
    assert_eq!(package.3, PackageStatus::Created as u32); // status
    
    // 4. Claim package (recipient auth required)
    env.mock_all_auths();
    client.claim_package(&package_id).unwrap();
    
    // 5. Verify claimed
    let package = client.get_package(&package_id).unwrap().unwrap();
    assert_eq!(package.3, PackageStatus::Claimed as u32); // status
    
    // 6. Verify count
    assert_eq!(client.get_package_count(), 1);

    // Mint tokens to admin for funding
    token_admin_client.mint(&admin, &10_000);

    // Fund the contract (Pool)
    client.fund(&token_client.address, &admin, &5000);
    assert_eq!(token_client.balance(&contract_id), 5000);

    // Create package
    let pkg_id = 0;
    let expires_at = env.ledger().timestamp() + 86400; // 1 day from now

    let returned_id = client.create_package(
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &expires_at,
    );
    assert_eq!(returned_id, pkg_id);

    // Verify package details
    let package = client.get_package(&pkg_id);
    assert_eq!(package.recipient, recipient);
    assert_eq!(package.amount, 1000);
    assert_eq!(package.token, token_client.address);
    assert_eq!(package.status, PackageStatus::Created);

    // Claim package
    client.claim(&pkg_id);

    // Verify claimed state
    let package = client.get_package(&pkg_id);
    assert_eq!(package.status, PackageStatus::Claimed);

    // Verify funds moved
    assert_eq!(token_client.balance(&recipient), 1000);
    assert_eq!(token_client.balance(&contract_id), 4000);
}

#[test]
fn test_multiple_packages() {
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

    // Mint tokens to admin for funding
    token_admin_client.mint(&admin, &10_000);

    // Fund contract with enough for both packages
    client.fund(&token_client.address, &admin, &5000);
    assert_eq!(token_client.balance(&contract_id), 5000);

    // Create multiple packages with manual IDs
    let id1 = 100;
    let id2 = 101;
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(&id1, &recipient1, &500, &token_client.address, &expiry);
    client.create_package(&id2, &recipient2, &1000, &token_client.address, &expiry);

    // Verify each package is independent
    // get_package returns: (recipient, amount, token, status, created_at, expires_at)
    let p1 = client.get_package(&id1).unwrap().unwrap();
    let p2 = client.get_package(&id2).unwrap().unwrap();
    
    assert_eq!(p1.0, recipient1);  // recipient
    assert_eq!(p2.0, recipient2);  // recipient
    assert_eq!(p1.1, 500);         // amount
    assert_eq!(p2.1, 1000);        // amount
    let p1 = client.get_package(&id1);
    let p2 = client.get_package(&id2);

    assert_eq!(p1.recipient, recipient1);
    assert_eq!(p2.recipient, recipient2);
    assert_eq!(p1.amount, 500);
    assert_eq!(p2.amount, 1000);

    // Verify contract balance reflects locked funds
    assert_eq!(token_client.balance(&contract_id), 5000);
}

#[test]
fn test_error_cases() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    env.mock_all_auths();
    
    // Test invalid amount
    let result = client.create_package(&recipient, &0, &token, &86400);
    assert_eq!(result, Err(Error::InvalidAmount));
    
    // Create valid package first
    let package_id = client.create_package(&recipient, &1000, &token, &86400).unwrap();
    
    // Try to claim non-existent package - should return error
    let result = client.claim_package(&999);
    assert_eq!(result, Err(Error::PackageNotFound));
    
    // Get non-existent package - should return None (not an error)
    let result = client.get_package(&999);
    assert_eq!(result, Ok(None));
}
