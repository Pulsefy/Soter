#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
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
fn test_view_package_status() {
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

    // Mint tokens to admin for funding
    token_admin_client.mint(&admin, &10_000);

    // Fund the contract
    client.fund(&token_client.address, &admin, &5000);

    // 1. Check status for non-existent package
    let result = client.try_view_package_status(&999);
    assert_eq!(result, Err(Ok(Error::PackageNotFound)));

    // 2. Create package and check status
    let pkg_id = 1;
    let expires_at = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &1000,
        &token_client.address,
        &expires_at,
    );

    let status = client.view_package_status(&pkg_id);
    assert_eq!(status, PackageStatus::Created);

    // 3. Claim package and check status
    client.claim(&pkg_id);

    let status_after_claim = client.view_package_status(&pkg_id);
    assert_eq!(status_after_claim, PackageStatus::Claimed);
}
