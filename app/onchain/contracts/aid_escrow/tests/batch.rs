#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, BatchAdminActionStatus, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, String, Symbol, Vec,
};

const UNIT: i128 = 10_000_000; // 1.0 Token for 7-decimal assets

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

fn empty_metadata(env: &Env, count: u32) -> Vec<Map<soroban_sdk::Symbol, soroban_sdk::String>> {
    let mut metadatas = Vec::new(env);
    for _ in 0..count {
        metadatas.push_back(Map::new(env));
    }
    metadatas
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
    // Mint and fund 10.0 tokens
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());
    recipients.push_back(recipient3.clone());

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT); // 1.0
    amounts.push_back(2 * UNIT); // 2.0
    amounts.push_back(3 * UNIT); // 3.0

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 3),
    );

    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(client.get_package(&0).recipient, recipient1);
}

#[test]
fn test_batch_create_packages_insufficient_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    // Fund with exactly 1.0 token
    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let mut recipients = Vec::new(&env);
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT); // Uses the full 1.0 token
    amounts.push_back(UNIT); // Needs another 1.0 token (Insufficient)

    let result = client.try_batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 2),
    );

    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

#[test]
fn test_batch_then_individual_no_id_collision() {
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
    token_admin_client.mint(&admin, &(5 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);
    amounts.push_back(UNIT);

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 2),
    );

    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(ids.get(1).unwrap(), 1);

    let manual_id = 100;
    let expiry = env.ledger().timestamp() + 86400;
    client.create_package(
        &admin,
        &manual_id,
        &recipient3,
        &UNIT,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );

    assert_eq!(client.get_package(&manual_id).recipient, recipient3);
}

#[test]
fn test_batch_create_packages_mismatched_arrays() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, _) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    let mut recipients = Vec::new(&env);
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));

    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT); // Only 1 amount for 2 recipients

    let result = client.try_batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 2),
    );
    assert_eq!(result, Err(Ok(Error::MismatchedArrays)));
}

#[test]
fn test_batch_create_packages_empty_arrays() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, _) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    let recipients: Vec<Address> = Vec::new(&env);
    let amounts: Vec<i128> = Vec::new(&env);

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &Vec::new(&env),
    );
    assert_eq!(ids.len(), 0);
}

#[test]
fn test_batch_revoke_is_partial_and_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &(3 * UNIT));
    client.fund(&token_client.address, &admin, &(3 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));
    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);
    amounts.push_back(UNIT);
    amounts.push_back(UNIT);
    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400,
        &empty_metadata(&env, 3),
    );

    let mut revoke_ids = Vec::new(&env);
    revoke_ids.push_back(ids.get(0).unwrap());
    revoke_ids.push_back(99);
    revoke_ids.push_back(ids.get(1).unwrap());
    revoke_ids.push_back(ids.get(0).unwrap());
    let results = client.batch_revoke(&revoke_ids);

    assert_eq!(
        results.get(0).unwrap().status,
        BatchAdminActionStatus::Success
    );
    assert_eq!(
        results.get(1).unwrap().status,
        BatchAdminActionStatus::NotFound
    );
    assert_eq!(
        results.get(2).unwrap().status,
        BatchAdminActionStatus::Success
    );
    assert_eq!(
        results.get(3).unwrap().status,
        BatchAdminActionStatus::InvalidState
    );
    assert_eq!(client.get_total_locked(&token_client.address), UNIT);
    assert_eq!(client.get_total_claimed(&token_client.address), 0);
    assert_eq!(
        client.get_aggregates(&token_client.address).total_committed,
        UNIT
    );
}

#[test]
fn test_batch_refund_is_partial_and_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &(3 * UNIT));
    client.fund(&token_client.address, &admin, &(3 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));
    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);
    amounts.push_back(UNIT);
    amounts.push_back(UNIT);
    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &1,
        &empty_metadata(&env, 3),
    );

    client.revoke(&ids.get(0).unwrap());
    env.ledger().set_timestamp(2);

    let mut refund_ids = Vec::new(&env);
    refund_ids.push_back(ids.get(0).unwrap());
    refund_ids.push_back(ids.get(1).unwrap());
    refund_ids.push_back(99);
    refund_ids.push_back(ids.get(1).unwrap());
    let results = client.batch_refund(&refund_ids);

    assert_eq!(
        results.get(0).unwrap().status,
        BatchAdminActionStatus::Success
    );
    assert_eq!(
        results.get(1).unwrap().status,
        BatchAdminActionStatus::Success
    );
    assert_eq!(
        results.get(2).unwrap().status,
        BatchAdminActionStatus::NotFound
    );
    assert_eq!(
        results.get(3).unwrap().status,
        BatchAdminActionStatus::InvalidState
    );
    assert_eq!(client.get_total_locked(&token_client.address), UNIT);
    let aggregates = client.get_aggregates(&token_client.address);
    assert_eq!(aggregates.total_committed, UNIT);
    assert_eq!(aggregates.total_expired_cancelled, 2 * UNIT);
    assert_eq!(client.get_total_claimed(&token_client.address), 0);
}

#[test]
fn test_batch_refund_respects_campaign_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient);
    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);

    let mut metadata = Map::new(&env);
    metadata.set(
        Symbol::new(&env, "campaign_ref"),
        String::from_str(&env, "camp-a"),
    );
    let mut metadatas = Vec::new(&env);
    metadatas.push_back(metadata);

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &1,
        &metadatas,
    );

    // Advance past expiry so the package would otherwise be refundable.
    env.ledger().set_timestamp(2);
    client.pause_campaign(&String::from_str(&env, "camp-a"));

    let mut refund_ids = Vec::new(&env);
    refund_ids.push_back(ids.get(0).unwrap());
    let results = client.batch_refund(&refund_ids);

    assert_eq!(
        results.get(0).unwrap().status,
        BatchAdminActionStatus::CampaignPaused
    );
    // Nothing should have moved: still locked, still Created.
    assert_eq!(client.get_total_locked(&token_client.address), UNIT);
    assert_eq!(
        client.get_package(&ids.get(0).unwrap()).status,
        PackageStatus::Created
    );
}

#[test]
fn test_batch_refund_reports_transfer_failed_and_preserves_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient);
    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &1,
        &empty_metadata(&env, 1),
    );

    env.ledger().set_timestamp(2);
    // Drain the contract's own token balance so the refund transfer reverts.
    token_admin_client.burn(&contract_id, &UNIT);

    let mut refund_ids = Vec::new(&env);
    refund_ids.push_back(ids.get(0).unwrap());
    let results = client.batch_refund(&refund_ids);

    assert_eq!(
        results.get(0).unwrap().status,
        BatchAdminActionStatus::TransferFailed
    );
    // Accounting and status must be untouched on a failed transfer.
    assert_eq!(
        client.get_package(&ids.get(0).unwrap()).status,
        PackageStatus::Created
    );
    assert_eq!(client.get_total_locked(&token_client.address), UNIT);
}

#[test]
fn test_batch_revoke_and_refund_are_idempotent_across_separate_calls() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &(2 * UNIT));
    client.fund(&token_client.address, &admin, &(2 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(Address::generate(&env));
    recipients.push_back(Address::generate(&env));
    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);
    amounts.push_back(UNIT);
    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &1,
        &empty_metadata(&env, 2),
    );

    // --- revoke: first call succeeds, second call (separate tx) is a no-op ---
    let mut revoke_ids = Vec::new(&env);
    revoke_ids.push_back(ids.get(0).unwrap());
    let first_revoke = client.batch_revoke(&revoke_ids);
    assert_eq!(
        first_revoke.get(0).unwrap().status,
        BatchAdminActionStatus::Success
    );
    let locked_after_first = client.get_total_locked(&token_client.address);

    let second_revoke = client.batch_revoke(&revoke_ids);
    assert_eq!(
        second_revoke.get(0).unwrap().status,
        BatchAdminActionStatus::InvalidState
    );
    assert_eq!(
        client.get_total_locked(&token_client.address),
        locked_after_first
    );

    // --- refund: first call succeeds, second call (separate tx) is a no-op ---
    env.ledger().set_timestamp(2);
    let mut refund_ids = Vec::new(&env);
    refund_ids.push_back(ids.get(1).unwrap());
    let first_refund = client.batch_refund(&refund_ids);
    assert_eq!(
        first_refund.get(0).unwrap().status,
        BatchAdminActionStatus::Success
    );
    let admin_balance_after_first = token_client.balance(&admin);
    let locked_after_first_refund = client.get_total_locked(&token_client.address);

    let second_refund = client.batch_refund(&refund_ids);
    assert_eq!(
        second_refund.get(0).unwrap().status,
        BatchAdminActionStatus::InvalidState
    );
    // No double payout, no accounting drift on the repeated call.
    assert_eq!(token_client.balance(&admin), admin_balance_after_first);
    assert_eq!(
        client.get_total_locked(&token_client.address),
        locked_after_first_refund
    );
}
