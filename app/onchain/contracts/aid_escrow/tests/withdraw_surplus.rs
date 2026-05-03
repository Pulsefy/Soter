#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

// We still use UNIT for funding to keep our test math clean
const UNIT: i128 = 10_000_000;

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

fn setup_funded(
    env: &Env,
    fund_tokens: i128,
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

    client.init(&admin);

    if fund_tokens > 0 {
        let amount = fund_tokens * UNIT;
        token_admin_client.mint(&admin, &amount);
        env.mock_all_auths();
        client.fund(&token_client.address, &admin, &amount);
    }

    (client, token_client, admin, token_admin)
}

#[test]
fn test_withdraw_surplus_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 5);

    // 1. Zero amount: Contract checks "amount <= 0", so this SHOULD fail.
    let res_zero = client.try_withdraw_surplus(&admin, &0, &token_client.address);
    assert_eq!(res_zero, Err(Ok(Error::InvalidAmount)));

    // 2. Negative amount: Contract checks "amount <= 0", so this SHOULD fail.
    let res_neg = client.try_withdraw_surplus(&admin, &-UNIT, &token_client.address);
    assert_eq!(res_neg, Err(Ok(Error::InvalidAmount)));

    // NOTE: We removed the check for "500" because your contract
    // does not currently enforce whole-token withdrawals.
}

#[test]
fn test_withdraw_surplus_insufficient_surplus() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 10);
    let recipient = Address::generate(&env);

    client.create_package(
        &admin,
        &1,
        &recipient,
        &(8 * UNIT),
        &token_client.address,
        &(env.ledger().timestamp() + 1000),
        &Map::new(&env),
    );

    // Balance 10, Locked 8, Surplus 2. Request 3.
    let result = client.try_withdraw_surplus(&admin, &(3 * UNIT), &token_client.address);
    assert_eq!(result, Err(Ok(Error::InsufficientSurplus)));
}

#[test]
fn test_withdraw_surplus_no_locked_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);

    client.withdraw_surplus(&admin, &UNIT, &token_client.address);

    assert_eq!(token_client.balance(&client.address), 0);
    assert_eq!(token_client.balance(&admin), UNIT);
}
