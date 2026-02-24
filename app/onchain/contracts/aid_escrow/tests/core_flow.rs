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
    client.create_package(&pkg_id, &recipient, &1000, &token_client.address, &expiry);

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
    client.create_package(&2, &recipient, &1000, &token_client.address, &0);

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
    client.create_package(&pkg_id, &recipient, &500, &token_client.address, &expiry);

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
    client.create_package(&pkg_id, &recipient, &500, &token_client.address, &0);

    // Revoke
    client.revoke(&pkg_id);

    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Cancelled);

    // Funds are now unlocked. We can create a new package using those same funds.
    // If they were still locked, this would fail (Balance 1000, Used 500. Available 500. Request 1000 -> Fail).
    // Since revoked, Available should be 1000 again.
    let pkg_id_2 = 2;
    client.create_package(&pkg_id_2, &recipient, &1000, &token_client.address, &0);
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

    // Mint and fund contract
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &10_000);

    // Create batch of packages
    let recipients = soroban_sdk::vec![
        &env,
        recipient1.clone(),
        recipient2.clone(),
        recipient3.clone()
    ];
    let amounts = soroban_sdk::vec![&env, 1000_i128, 2000_i128, 1500_i128];
    let expires_in = 86400_u64; // 1 day

    let package_ids =
        client.batch_create_packages(&recipients, &amounts, &token_client.address, &expires_in);

    // Verify all packages were created
    assert_eq!(package_ids.len(), 3);

    // Verify first package
    let pkg1 = client.get_package(&package_ids.get(0).unwrap());
    assert_eq!(pkg1.status, PackageStatus::Created);
    assert_eq!(pkg1.recipient, recipient1);
    assert_eq!(pkg1.amount, 1000);

    // Verify second package
    let pkg2 = client.get_package(&package_ids.get(1).unwrap());
    assert_eq!(pkg2.status, PackageStatus::Created);
    assert_eq!(pkg2.recipient, recipient2);
    assert_eq!(pkg2.amount, 2000);

    // Verify third package
    let pkg3 = client.get_package(&package_ids.get(2).unwrap());
    assert_eq!(pkg3.status, PackageStatus::Created);
    assert_eq!(pkg3.recipient, recipient3);
    assert_eq!(pkg3.amount, 1500);

    // Verify contract still holds all funds (packages lock funds, don't transfer them)
    assert_eq!(token_client.balance(&contract_id), 10_000);
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

    // Fund with insufficient amount
    token_admin_client.mint(&admin, &1000);
    client.fund(&token_client.address, &admin, &1000);

    // Try to create batch that exceeds available balance
    let recipients = soroban_sdk::vec![&env, recipient1.clone(), recipient2.clone()];
    let amounts = soroban_sdk::vec![&env, 800_i128, 500_i128]; // Total 1300 > 1000

    let res = client.try_batch_create_packages(&recipients, &amounts, &token_client.address, &0);
    assert_eq!(res, Err(Ok(Error::InsufficientFunds)));
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

    token_admin_client.mint(&admin, &1000);
    client.fund(&token_client.address, &admin, &1000);

    // Create package with initial expiration
    let start_time = 1000;
    env.ledger().set_timestamp(start_time);
    let pkg_id = 1;
    let initial_expiry = start_time + 3600; // 1 hour
    client.create_package(
        &pkg_id,
        &recipient,
        &500,
        &token_client.address,
        &initial_expiry,
    );

    // Verify initial expiration
    let pkg_before = client.get_package(&pkg_id);
    assert_eq!(pkg_before.expires_at, initial_expiry);

    // Extend expiration by 1 hour
    let additional_time = 3600_u64;
    client.extend_expiration(&pkg_id, &additional_time);

    // Verify expiration was extended
    let pkg_after = client.get_package(&pkg_id);
    assert_eq!(pkg_after.expires_at, initial_expiry + additional_time);
    assert_eq!(pkg_after.status, PackageStatus::Created);
}

#[test]
fn test_extend_expiration_errors() {
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

    // Test extending non-existent package
    let res = client.try_extend_expiration(&999, &3600);
    assert_eq!(res, Err(Ok(Error::PackageNotFound)));

    // Create and claim a package
    let pkg_id = 1;
    client.create_package(&pkg_id, &recipient, &500, &token_client.address, &0);
    client.claim(&pkg_id);

    // Test extending already claimed package
    let res2 = client.try_extend_expiration(&pkg_id, &3600);
    assert_eq!(res2, Err(Ok(Error::PackageNotActive)));

    // Create package with expiration and let it expire
    let start_time = 1000;
    env.ledger().set_timestamp(start_time);
    let pkg_id_2 = 2;
    let expiry = start_time + 100;
    client.create_package(&pkg_id_2, &recipient, &500, &token_client.address, &expiry);

    // Advance time past expiry
    env.ledger().set_timestamp(expiry + 1);

    // Test extending expired package
    let res3 = client.try_extend_expiration(&pkg_id_2, &3600);
    assert_eq!(res3, Err(Ok(Error::PackageExpired)));
}

#[test]
fn test_get_aggregates() {
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

    // Fund contract
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &10_000);

    // Create multiple packages
    client.create_package(&1, &recipient1, &1000, &token_client.address, &0);
    client.create_package(&2, &recipient2, &2000, &token_client.address, &0);
    client.create_package(&3, &recipient1, &1500, &token_client.address, &0);

    // Get aggregates - all packages in Created state
    let agg1 = client.get_aggregates(&token_client.address);
    assert_eq!(agg1.total_committed, 4500); // 1000 + 2000 + 1500
    assert_eq!(agg1.total_claimed, 0);
    assert_eq!(agg1.total_expired_cancelled, 0);

    // Claim one package
    client.claim(&1);

    // Get aggregates after claim
    let agg2 = client.get_aggregates(&token_client.address);
    assert_eq!(agg2.total_committed, 3500); // 2000 + 1500
    assert_eq!(agg2.total_claimed, 1000);
    assert_eq!(agg2.total_expired_cancelled, 0);

    // Cancel one package
    client.cancel_package(&2);

    // Get aggregates after cancel
    let agg3 = client.get_aggregates(&token_client.address);
    assert_eq!(agg3.total_committed, 1500); // Only package 3
    assert_eq!(agg3.total_claimed, 1000); // Package 1
    assert_eq!(agg3.total_expired_cancelled, 2000); // Package 2

    // Claim remaining package
    client.claim(&3);

    // Get final aggregates
    let agg4 = client.get_aggregates(&token_client.address);
    assert_eq!(agg4.total_committed, 0);
    assert_eq!(agg4.total_claimed, 2500); // Package 1 + 3
    assert_eq!(agg4.total_expired_cancelled, 2000); // Package 2
}

#[test]
fn test_set_config_and_get_config() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, _token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    // Get default config
    let default_config = client.get_config();
    assert_eq!(default_config.min_amount, 1);
    assert_eq!(default_config.max_expires_in, 0);
    assert_eq!(default_config.allowed_tokens.len(), 0);

    // Create new config
    let new_config = aid_escrow::Config {
        min_amount: 100,
        max_expires_in: 86400, // 1 day
        allowed_tokens: soroban_sdk::vec![&env, token_client.address.clone()],
    };

    // Set new config
    client.set_config(&new_config);

    // Get and verify updated config
    let updated_config = client.get_config();
    assert_eq!(updated_config.min_amount, 100);
    assert_eq!(updated_config.max_expires_in, 86400);
    assert_eq!(updated_config.allowed_tokens.len(), 1);
    assert_eq!(
        updated_config.allowed_tokens.get(0).unwrap(),
        token_client.address
    );
}

#[test]
fn test_set_config_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    // Try to set config with invalid min_amount (0 or negative)
    let invalid_config = aid_escrow::Config {
        min_amount: 0,
        max_expires_in: 0,
        allowed_tokens: soroban_sdk::vec![&env],
    };

    let res = client.try_set_config(&invalid_config);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}
