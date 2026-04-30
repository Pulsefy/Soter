#![cfg(test)]
use aid_escrow::{AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

const UNIT: i128 = 10_000_000;

#[test]
fn test_core_accounting_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Register token
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let token = TokenClient::new(&env, &token_address);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    // 1. Funding Invariant
    let fund_amount = 50 * UNIT;
    token_admin_client.mint(&admin, &fund_amount);
    client.fund(&token_address, &admin, &fund_amount);

    // 2. Creation Invariant: Locked + Surplus == Balance
    client.create_package(
        &admin,
        &1,
        &recipient,
        &(10 * UNIT),
        &token_address,
        &0,
        &Map::new(&env),
    );

    let locked = client.get_total_locked(&token_address);

    // FIX: Access .address as a field, not a method call ()
    let balance = token.balance(&client.address);

    assert_eq!(locked, 10 * UNIT);
    assert!(balance >= locked, "Contract must be solvent");

    // 3. Claim Invariant: Total Claimed + Current Balance == Total Funded
    client.claim(&1);

    let total_claimed = client.get_total_claimed(&token_address);

    // FIX: Access .address as a field, not a method call ()
    let current_balance = token.balance(&client.address);
    let final_locked = client.get_total_locked(&token_address);

    assert_eq!(final_locked, 0, "Locked should return to zero");
    assert_eq!(
        total_claimed,
        10 * UNIT,
        "Claimed map should record 10 units"
    );
    assert_eq!(
        total_claimed + current_balance,
        fund_amount,
        "Conservation of value failed"
    );
}
