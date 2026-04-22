#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient};
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
fn test_list_recipient_packages_few_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let other_recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &10_000);

    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(&admin, &1, &recipient, &1000, &token_client.address, &expiry);
    client.create_package(
        &admin,
        &2,
        &other_recipient,
        &1500,
        &token_client.address,
        &expiry,
    );
    client.create_package(&admin, &3, &recipient, &2000, &token_client.address, &expiry);

    let listed = client.list_recipient_packages(&recipient, &0, &10);
    assert_eq!(listed.len(), 2);
    assert_eq!(listed.get(0).unwrap(), 1);
    assert_eq!(listed.get(1).unwrap(), 3);
}

#[test]
fn test_list_recipient_packages_paged() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let other_recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &10_000);

    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(&admin, &10, &recipient, &1000, &token_client.address, &expiry);
    client.create_package(&admin, &11, &recipient, &1000, &token_client.address, &expiry);
    client.create_package(&admin, &12, &recipient, &1000, &token_client.address, &expiry);
    client.create_package(&admin, &13, &recipient, &1000, &token_client.address, &expiry);
    client.create_package(
        &admin,
        &14,
        &other_recipient,
        &1000,
        &token_client.address,
        &expiry,
    );

    let first_page = client.list_recipient_packages(&recipient, &0, &2);
    assert_eq!(first_page.len(), 2);
    assert_eq!(first_page.get(0).unwrap(), 10);
    assert_eq!(first_page.get(1).unwrap(), 11);

    let second_page = client.list_recipient_packages(&recipient, &2, &2);
    assert_eq!(second_page.len(), 2);
    assert_eq!(second_page.get(0).unwrap(), 12);
    assert_eq!(second_page.get(1).unwrap(), 13);
}
