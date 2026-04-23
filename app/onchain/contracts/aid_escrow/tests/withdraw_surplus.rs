#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error};
use soroban_sdk::{
    Address, Env,
    testutils::{Address as _, Events},
    token::{StellarAssetClient, TokenClient},
};

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

/// Helper: set up contract, token, fund, and return the client + token client.
fn setup_funded(
    env: &Env,
    fund_amount: i128,
) -> (
    AidEscrowClient<'static>,
    TokenClient<'static>,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_client, token_admin_client) = setup_token(env, &token_admin);

    let contract_address = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(env, &contract_address);

    // Initialize contract
    client.init(&admin);

    // Mint and fund tokens
    if fund_amount > 0 {
        token_admin_client.mint(&admin, &fund_amount);
        env.mock_all_auths();
        client.fund(&token_client.address, &admin, &fund_amount);
    }

    (client, token_client, admin, token_admin)
}

#[test]
fn test_withdraw_surplus_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1000);

    // Try to withdraw zero amount
    let result = client.try_withdraw_surplus(&admin, &0, &token_client.address);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));

    // Try to withdraw negative amount
    let result = client.try_withdraw_surplus(&admin, &-100, &token_client.address);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_withdraw_surplus_insufficient_surplus() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1000);
    let recipient = Address::generate(&env);

    // Create a package that locks 800 tokens
    client.create_package(
        &admin,
        &1,
        &recipient,
        &800,
        &token_client.address,
        &(&env.ledger().timestamp() + 1000),
    );

    // Try to withdraw 300 tokens from surplus (1000 balance - 800 locked = 200 surplus available)
    let result = client.try_withdraw_surplus(&admin, &300, &token_client.address);
    assert_eq!(result, Err(Ok(Error::InsufficientSurplus)));
}

#[test]
fn test_withdraw_surplus_no_locked_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1000);

    // Withdraw 500 tokens (all should be surplus)
    client.withdraw_surplus(&admin, &500, &token_client.address);

    // Verify events were emitted (EscrowFunded + token transfers + SurplusWithdrawn)
    let events = env.events().all();
    assert!(events.len() >= 2);
}
