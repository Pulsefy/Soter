#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

const UNIT: i128 = 10_000_000; // 1.0 Token (7 decimals)

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

    // Mint tokens to admin for funding (10.0 tokens)
    token_admin_client.mint(&admin, &(10 * UNIT));

    // Fund the contract (5.0 tokens)
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    // 1. Check status for non-existent package
    let result = client.try_view_package_status(&999);
    assert_eq!(result, Err(Ok(Error::PackageNotFound)));

    // 2. Create package (1.0 token) and check status
    let pkg_id = 1;
    let expires_at = env.ledger().timestamp() + 86400;

    let metadata = Map::new(&env);
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &metadata,
    );

    let status = client.view_package_status(&pkg_id);
    assert_eq!(status, PackageStatus::Created);

    // 3. Claim package and check status
    client.claim(&pkg_id);

    let status_after_claim = client.view_package_status(&pkg_id);
    assert_eq!(status_after_claim, PackageStatus::Claimed);
}
