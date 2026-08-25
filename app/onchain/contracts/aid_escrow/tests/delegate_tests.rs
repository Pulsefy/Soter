#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, String, Vec,
};

const UNIT: i128 = 10_000_000;

fn setup() -> (
    Env,
    AidEscrowClient<'static>,
    Address,
    Address,
    Address,
    TokenClient<'static>,
    StellarAssetClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let delegate = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let token_client = TokenClient::new(&env, &token);
    let token_admin_client = StellarAssetClient::new(&env, &token);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token, &admin, &(10 * UNIT));

    (
        env,
        client,
        admin,
        recipient,
        delegate,
        token_client,
        token_admin_client,
    )
}

fn create_package(
    client: &AidEscrowClient<'static>,
    admin: &Address,
    recipient: &Address,
    token: &Address,
    id: u64,
) {
    let metadata = Map::new(&client.env);
    client.create_package(admin, &id, recipient, &UNIT, token, &86400, &metadata);
}

#[test]
fn test_set_and_query_delegate() {
    let (_env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;
    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    // Query before setting - should be None
    assert_eq!(client.get_delegate(&pkg_id), None);

    // Set delegate
    client.set_delegate(&admin, &pkg_id, &delegate);

    // Query after setting
    let queried = client.get_delegate(&pkg_id);
    assert_eq!(queried, Some(delegate.clone()));

    // Query info
    let info = client.get_delegate_info(&pkg_id);
    assert!(info.is_some());
    let (addr, expiry) = info.unwrap();
    assert_eq!(addr, delegate);
    assert_eq!(expiry, None);
}

#[test]
fn test_set_delegate_with_expiry_and_query() {
    let (env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;
    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    let expires_at = 2000u64;
    client.set_delegate_with_expiry(&admin, &pkg_id, &delegate, &expires_at);

    let info = client.get_delegate_info(&pkg_id);
    assert!(info.is_some());
    let (addr, expiry) = info.unwrap();
    assert_eq!(addr, delegate);
    assert_eq!(expiry, Some(expires_at));

    // Before expiry, delegate is returned
    assert_eq!(client.get_delegate(&pkg_id), Some(delegate.clone()));

    // Advance past expiry
    env.ledger().set_timestamp(expires_at + 1);
    assert_eq!(client.get_delegate(&pkg_id), None);
}

#[test]
fn test_remove_delegate() {
    let (_env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;
    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    client.set_delegate(&admin, &pkg_id, &delegate);
    assert_eq!(client.get_delegate(&pkg_id), Some(delegate.clone()));

    // Remove delegate
    client.revoke_delegate(&admin, &pkg_id);
    assert_eq!(client.get_delegate(&pkg_id), None);
}

#[test]
fn test_delegate_history_tracking() {
    let (env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;
    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    let delegate2 = Address::generate(&env);

    // No history initially
    let history = client.get_delegate_history(&pkg_id);
    assert_eq!(history.len(), 0);

    // Set first delegate
    client.set_delegate(&admin, &pkg_id, &delegate);
    let history = client.get_delegate_history(&pkg_id);
    assert_eq!(history.len(), 1);

    // Update to second delegate
    client.set_delegate(&admin, &pkg_id, &delegate2);
    let history = client.get_delegate_history(&pkg_id);
    assert_eq!(history.len(), 2);

    let first = history.get(0).unwrap();
    assert_eq!(first.previous_delegate, None);
    assert_eq!(first.new_delegate, delegate);

    let second = history.get(1).unwrap();
    assert_eq!(second.previous_delegate, Some(delegate));
    assert_eq!(second.new_delegate, delegate2);
}

#[test]
fn test_delegate_claim_via_claim_with_proof() {
    let (env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;

    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    // Set delegate
    client.set_delegate(&admin, &pkg_id, &delegate);

    // Delegate claims via claim_with_proof (empty proof, non-Merkle package)
    let empty_proof: Vec<String> = Vec::new(&env);
    client.claim_with_proof(&pkg_id, &delegate, &empty_proof);

    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Claimed);
    assert_eq!(token_client.balance(&delegate), UNIT);

    // Delegate should be cleared after claim
    assert_eq!(client.get_delegate(&pkg_id), None);
}

#[test]
fn test_delegate_claim_clears_delegate() {
    let (env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;

    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    client.set_delegate(&admin, &pkg_id, &delegate);
    assert_eq!(client.get_delegate(&pkg_id), Some(delegate.clone()));

    // Delegate claims
    let empty_proof: Vec<String> = Vec::new(&env);
    client.claim_with_proof(&pkg_id, &delegate, &empty_proof);

    // Delegate should be cleared
    assert_eq!(client.get_delegate(&pkg_id), None);

    // History should reflect the clearing
    let history = client.get_delegate_history(&pkg_id);
    assert!(history.len() >= 2);
}

#[test]
fn test_recipient_claim_also_clears_delegate() {
    let (_env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;

    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    client.set_delegate(&admin, &pkg_id, &delegate);

    // Recipient claims directly
    client.claim(&pkg_id);

    // Delegate should be cleared
    assert_eq!(client.get_delegate(&pkg_id), None);

    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Claimed);
    assert_eq!(token_client.balance(&recipient), UNIT);
}

#[test]
fn test_stranger_cannot_claim_as_delegate() {
    let (env, client, admin, recipient, _delegate, token_client, _) = setup();
    let pkg_id = 1;

    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    // Set delegate
    let delegate = Address::generate(&env);
    client.set_delegate(&admin, &pkg_id, &delegate);

    // Stranger tries to claim
    let stranger = Address::generate(&env);
    let empty_proof: Vec<String> = Vec::new(&env);
    let result = client.try_claim_with_proof(&pkg_id, &stranger, &empty_proof);
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));

    // Package still unclaimed
    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Created);
}

#[test]
fn test_expired_delegate_cannot_claim() {
    let (env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;

    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    let now = env.ledger().timestamp();
    let expires_at = now + 100;
    client.set_delegate_with_expiry(&admin, &pkg_id, &delegate, &expires_at);

    // Advance past expiry
    env.ledger().set_timestamp(expires_at + 1);

    // Delegate tries to claim - should fail
    let empty_proof: Vec<String> = Vec::new(&env);
    let result = client.try_claim_with_proof(&pkg_id, &delegate, &empty_proof);
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));

    // Package still unclaimed
    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Created);
}

#[test]
fn test_cannot_set_delegate_for_nonexistent_package() {
    let (_env, client, admin, _recipient, delegate, _token_client, _) = setup();

    let result = client.try_set_delegate(&admin, &999, &delegate);
    assert_eq!(result, Err(Ok(Error::PackageNotFound)));
}

#[test]
fn test_cannot_set_delegate_for_claimed_package() {
    let (_env, client, admin, recipient, delegate, token_client, _) = setup();
    let pkg_id = 1;

    let token = token_client.address;
    create_package(&client, &admin, &recipient, &token, pkg_id);

    // Claim first
    client.claim(&pkg_id);

    // Try setting delegate on claimed package
    let result = client.try_set_delegate(&admin, &pkg_id, &delegate);
    assert_eq!(result, Err(Ok(Error::PackageNotActive)));
}

#[test]
fn test_cannot_set_delegate_to_recipient() {
    let (_env, client, admin, recipient, _delegate, token_client, _) = setup();
    let pkg_id = 1;
    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, pkg_id);

    let result = client.try_set_delegate(&admin, &pkg_id, &recipient);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn test_cleanup_expired_delegates() {
    let (env, client, admin, recipient, delegate1, token_client, _) = setup();
    let delegate2 = Address::generate(&env);

    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, 1);
    create_package(&client, &admin, &recipient, &token, 2);

    let now = env.ledger().timestamp();

    // Set delegates with different expirations
    client.set_delegate_with_expiry(&admin, &1, &delegate1, &(now + 50));
    client.set_delegate_with_expiry(&admin, &2, &delegate2, &(now + 200));

    assert_eq!(client.get_delegate(&1), Some(delegate1.clone()));
    assert_eq!(client.get_delegate(&2), Some(delegate2.clone()));

    // Advance past first delegate's expiration
    env.ledger().set_timestamp(now + 100);

    // Cleanup
    let cleaned = client.cleanup_expired_delegates(&admin);
    assert_eq!(cleaned, 1);

    // First delegate should be gone
    assert_eq!(client.get_delegate(&1), None);

    // Second delegate should remain
    assert_eq!(client.get_delegate(&2), Some(delegate2));
}

#[test]
fn test_sweep_expired_delegates_by_any_address() {
    let (env, client, admin, recipient, delegate1, token_client, _) = setup();
    let delegate2 = Address::generate(&env);

    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, 10);
    create_package(&client, &admin, &recipient, &token, 11);

    let now = env.ledger().timestamp();
    client.set_delegate_with_expiry(&admin, &10, &delegate1, &(now + 30));
    client.set_delegate_with_expiry(&admin, &11, &delegate2, &(now + 30));

    // Advance to boundary time (exact expiry timestamp)
    env.ledger().set_timestamp(now + 30);

    // get_delegate and get_delegate_info must return None immediately
    assert_eq!(client.get_delegate(&10), None);
    assert_eq!(client.get_delegate_info(&10), None);
    assert_eq!(client.get_delegate(&11), None);
    assert_eq!(client.get_delegate_info(&11), None);

    // Stranger (non-admin, any address) calls sweep in batch of 1
    let swept = client.sweep_expired_delegates(&1);
    assert_eq!(swept, 1);

    // Stranger calls sweep for remaining expired delegate
    let swept_remaining = client.sweep_expired_delegates(&10);
    assert_eq!(swept_remaining, 1);

    // Repeated call returns 0 cleanly
    assert_eq!(client.sweep_expired_delegates(&10), 0);
}

#[test]
fn test_get_delegate_boundary_and_expiry_semantics() {
    let (env, client, admin, recipient, delegate, token_client, _) = setup();
    let token = token_client.address.clone();
    create_package(&client, &admin, &recipient, &token, 1);

    let now = env.ledger().timestamp();
    let expiry = now + 100;
    client.set_delegate_with_expiry(&admin, &1, &delegate, &expiry);

    // Unexpired (now < expiry)
    env.ledger().set_timestamp(expiry - 1);
    assert_eq!(client.get_delegate(&1), Some(delegate.clone()));
    let info = client.get_delegate_info(&1);
    assert!(info.is_some());
    assert_eq!(info.unwrap(), (delegate.clone(), Some(expiry)));

    // Boundary time (now == expiry) -> expired!
    env.ledger().set_timestamp(expiry);
    assert_eq!(client.get_delegate(&1), None);
    assert_eq!(client.get_delegate_info(&1), None);

    // Expired (now > expiry) -> expired!
    env.ledger().set_timestamp(expiry + 10);
    assert_eq!(client.get_delegate(&1), None);
    assert_eq!(client.get_delegate_info(&1), None);
}
