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
