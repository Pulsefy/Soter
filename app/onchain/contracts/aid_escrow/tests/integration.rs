#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error, PackageStatus};
use soroban_sdk::{
    Address, Env, Vec,
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

    // Mint tokens to admin for funding
    token_admin_client.mint(&admin, &10_000);

    // Fund the contract (Pool)
    client.fund(&token_client.address, &admin, &5000);
    assert_eq!(token_client.balance(&contract_id), 5000);

    // Create package
    let pkg_id = 0;
    let expires_at = env.ledger().timestamp() + 86400; // 1 day from now

    let returned_id = client.create_package(
        &admin,
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

    client.create_package(
        &admin,
        &id1,
        &recipient1,
        &500,
        &token_client.address,
        &expiry,
    );
    client.create_package(
        &admin,
        &id2,
        &recipient2,
        &1000,
        &token_client.address,
        &expiry,
    );

    // Verify each package is independent
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

    client.init(&admin);

    // Mint tokens to admin for funding
    token_admin_client.mint(&admin, &10_000);

    // Fund contract
    client.fund(&token_client.address, &admin, &5000);

    // Test invalid amount (0)
    let result =
        client.try_create_package(&admin, &0, &recipient, &0, &token_client.address, &86400);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));

    // Create valid package first to establish state
    let pkg_id = 1;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &86400,
    );

    // Try to claim non-existent package
    let result = client.try_claim(&999);
    assert_eq!(result, Err(Ok(Error::PackageNotFound)));

    // Get non-existent package
    let result = client.try_get_package(&999);
    assert_eq!(result, Err(Ok(Error::PackageNotFound)));
}

#[test]
fn test_set_get_config() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let allowed_token_admin = Address::generate(&env);
    let (allowed_token_client, _) = setup_token(&env, &allowed_token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    let mut allowed_tokens = Vec::new(&env);
    allowed_tokens.push_back(allowed_token_client.address.clone());

    let config = Config {
        min_amount: 50,
        max_expires_in: 3600,
        allowed_tokens,
    };
    client.set_config(&config);

    let stored = client.get_config();
    assert_eq!(stored, config);
}

#[test]
fn test_config_constraints_on_create_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let allowed_token_admin = Address::generate(&env);
    let blocked_token_admin = Address::generate(&env);
    let (allowed_token_client, allowed_token_admin_client) =
        setup_token(&env, &allowed_token_admin);
    let (blocked_token_client, _) = setup_token(&env, &blocked_token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    allowed_token_admin_client.mint(&admin, &10_000);
    client.fund(&allowed_token_client.address, &admin, &5000);

    let mut allowed_tokens = Vec::new(&env);
    allowed_tokens.push_back(allowed_token_client.address.clone());
    client.set_config(&Config {
        min_amount: 100,
        max_expires_in: 1000,
        allowed_tokens,
    });

    let now = env.ledger().timestamp();
    let too_small = client.try_create_package(
        &admin,
        &1,
        &recipient,
        &99,
        &allowed_token_client.address,
        &(now + 10),
    );
    assert_eq!(too_small, Err(Ok(Error::InvalidAmount)));

    let blocked_token = client.try_create_package(
        &admin,
        &2,
        &recipient,
        &200,
        &blocked_token_client.address,
        &(now + 10),
    );
    assert_eq!(blocked_token, Err(Ok(Error::InvalidState)));

    let too_far = client.try_create_package(
        &admin,
        &3,
        &recipient,
        &200,
        &allowed_token_client.address,
        &(now + 2000),
    );
    assert_eq!(too_far, Err(Ok(Error::InvalidState)));
}

#[test]
fn test_config_constraints_on_extend_expiration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    client.set_config(&Config {
        min_amount: 1,
        max_expires_in: 1000,
        allowed_tokens: Vec::new(&env),
    });

    let now = env.ledger().timestamp();
    let pkg_id = 1;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &(now + 500),
    );

    let result = client.try_extend_expiration(&pkg_id, &700);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn test_extend_expiration_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Create package with initial expiration
    let pkg_id = 1;
    let initial_expiry = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &initial_expiry,
    );

    // Verify initial expiration
    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.expires_at, initial_expiry);
    assert_eq!(pkg.status, PackageStatus::Created);

    // Extend expiration by 500 units
    let additional_time = 500;
    client.extend_expiration(&pkg_id, &additional_time);

    // Verify new expiration
    let pkg_extended = client.get_package(&pkg_id);
    assert_eq!(pkg_extended.expires_at, initial_expiry + additional_time);
    assert_eq!(pkg_extended.status, PackageStatus::Created);
}

#[test]
fn test_extend_expiration_non_existent_package() {
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

    // Try to extend non-existent package
    let result = client.try_extend_expiration(&999, &500);
    assert_eq!(result, Err(Ok(Error::PackageNotFound)));
}

#[test]
fn test_extend_expiration_claimed_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Create and claim package
    let pkg_id = 1;
    let expiry = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &expiry,
    );
    client.claim(&pkg_id);

    // Try to extend claimed package
    let result = client.try_extend_expiration(&pkg_id, &500);
    assert_eq!(result, Err(Ok(Error::PackageNotActive)));
}

#[test]
fn test_extend_expiration_expired_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Create package and advance time past expiration
    let start_time = 1000;
    env.ledger().set_timestamp(start_time);
    let pkg_id = 1;
    let expiry = start_time + 100;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &expiry,
    );

    env.ledger().set_timestamp(expiry + 1);

    // Try to extend expired package
    let result = client.try_extend_expiration(&pkg_id, &500);
    assert_eq!(result, Err(Ok(Error::PackageExpired)));
}

#[test]
fn test_extend_expiration_zero_additional_time() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Create package
    let pkg_id = 1;
    let expiry = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &expiry,
    );

    // Try to extend with zero additional time
    let result = client.try_extend_expiration(&pkg_id, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_extend_expiration_unbounded_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Create package with unbounded expiration (expires_at = 0)
    let pkg_id = 1;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &0,
    );

    // Try to extend unbounded package
    let result = client.try_extend_expiration(&pkg_id, &500);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn test_extend_expiration_multiple_extends() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Create package
    let pkg_id = 1;
    let initial_expiry = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &initial_expiry,
    );

    // Extend multiple times
    client.extend_expiration(&pkg_id, &100);
    let pkg1 = client.get_package(&pkg_id);
    assert_eq!(pkg1.expires_at, initial_expiry + 100);

    client.extend_expiration(&pkg_id, &200);
    let pkg2 = client.get_package(&pkg_id);
    assert_eq!(pkg2.expires_at, initial_expiry + 300);

    client.extend_expiration(&pkg_id, &500);
    let pkg3 = client.get_package(&pkg_id);
    assert_eq!(pkg3.expires_at, initial_expiry + 800);
}

#[test]
fn test_extend_expiration_cancelled_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    // Create and cancel package
    let pkg_id = 1;
    let expiry = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &expiry,
    );
    client.cancel_package(&pkg_id);

    // Try to extend cancelled package
    let result = client.try_extend_expiration(&pkg_id, &500);
    assert_eq!(result, Err(Ok(Error::PackageNotActive)));
}
