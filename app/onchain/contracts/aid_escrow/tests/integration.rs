#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Vec,
};

const UNIT: i128 = 10_000_000; // 1.0 Token (7 decimals)

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

#[test]
fn test_integration_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let pkg_id = 0;
    let expires_at = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );

    let package = client.get_package(&pkg_id);
    assert_eq!(package.amount, UNIT);
    assert_eq!(package.status, PackageStatus::Created);

    client.claim(&pkg_id);
    assert_eq!(token_client.balance(&recipient), UNIT);
    assert_eq!(token_client.balance(&contract_id), 4 * UNIT);
}

#[test]
fn test_multiple_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));

    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    client.create_package(
        &admin,
        &100,
        &recipient1,
        &UNIT,
        &token_client.address,
        &9999999,
        &Map::new(&env),
    );
    client.create_package(
        &admin,
        &101,
        &recipient2,
        &(2 * UNIT),
        &token_client.address,
        &9999999,
        &Map::new(&env),
    );

    assert_eq!(client.get_package(&100).amount, UNIT);
    assert_eq!(client.get_package(&101).amount, 2 * UNIT);
}

#[test]
fn test_error_cases() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &(5 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    // Case 1: Invalid amount (0)
    let res1 = client.try_create_package(
        &admin,
        &0,
        &Address::generate(&env),
        &0,
        &token_client.address,
        &86400,
        &Map::new(&env),
    );
    assert_eq!(res1, Err(Ok(Error::InvalidAmount)));

    // Case 2: Package not found
    let res2 = client.try_claim(&999);
    assert_eq!(res2, Err(Ok(Error::PackageNotFound)));
}

#[test]
fn test_set_get_config() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, _) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_client.address.clone());

    let config = Config {
        min_amount: UNIT,
        max_expires_in: 3600,
        allowed_tokens: tokens,
    };
    client.set_config(&config);
    assert_eq!(client.get_config(), config);
}

#[test]
fn test_config_constraints_on_create_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let (blocked_token, _) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    let mut allowed = Vec::new(&env);
    allowed.push_back(token_client.address.clone());
    client.set_config(&Config {
        min_amount: 5 * UNIT,
        max_expires_in: 1000,
        allowed_tokens: allowed,
    });

    let now = env.ledger().timestamp();

    // Fail: Below min_amount
    let res1 = client.try_create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &(now + 10),
        &Map::new(&env),
    );
    assert_eq!(res1, Err(Ok(Error::InvalidAmount)));

    // Fail: Token not allowed
    let res2 = client.try_create_package(
        &admin,
        &2,
        &Address::generate(&env),
        &(5 * UNIT),
        &blocked_token.address,
        &(now + 10),
        &Map::new(&env),
    );
    assert_eq!(res2, Err(Ok(Error::InvalidState)));

    // Fail: Expiry too far
    let res3 = client.try_create_package(
        &admin,
        &3,
        &Address::generate(&env),
        &(5 * UNIT),
        &token_client.address,
        &(now + 2000),
        &Map::new(&env),
    );
    assert_eq!(res3, Err(Ok(Error::InvalidState)));
}

#[test]
fn test_extend_expiration_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let expiry = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );

    client.extend_expiration(&1, &500);
    assert_eq!(client.get_package(&1).expires_at, expiry + 500);
}

#[test]
fn test_extend_expiry_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let initial = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &initial,
        &Map::new(&env),
    );

    let new_exp = initial + 500;
    client.extend_expiry(&1, &new_exp);
    assert_eq!(client.get_package(&1).expires_at, new_exp);
}

#[test]
fn test_extend_expiry_rejects_non_increasing_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let initial = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &initial,
        &Map::new(&env),
    );

    assert_eq!(
        client.try_extend_expiry(&1, &initial),
        Err(Ok(Error::InvalidState))
    );
    assert_eq!(
        client.try_extend_expiry(&1, &(initial - 1)),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_extend_expiration_zero_additional_time() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &9999999,
        &Map::new(&env),
    );
    assert_eq!(
        client.try_extend_expiration(&1, &0),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn test_extend_expiration_expired_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    env.ledger().set_timestamp(1000);
    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &1100,
        &Map::new(&env),
    );

    env.ledger().set_timestamp(1101);
    assert_eq!(
        client.try_extend_expiration(&1, &10),
        Err(Ok(Error::PackageExpired))
    );
}

#[test]
fn test_extend_expiration_claimed_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &9999999,
        &Map::new(&env),
    );
    client.claim(&1);
    assert_eq!(
        client.try_extend_expiration(&1, &10),
        Err(Ok(Error::PackageNotActive))
    );
}

#[test]
fn test_extend_expiration_cancelled_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &9999999,
        &Map::new(&env),
    );
    client.cancel_package(&1);
    assert_eq!(
        client.try_extend_expiration(&1, &10),
        Err(Ok(Error::PackageNotActive))
    );
}

#[test]
fn test_config_constraints_on_extend_expiration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    client.set_config(&Config {
        min_amount: UNIT,
        max_expires_in: 500,
        allowed_tokens: Vec::new(&env),
    });

    let now = env.ledger().timestamp();
    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &(now + 100),
        &Map::new(&env),
    );

    // Total expiry (100 + 500) = 600. Max allowed from creation is 500.
    assert_eq!(
        client.try_extend_expiration(&1, &500),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_get_recipient_package_count_returns_zero_when_recipient_has_no_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    assert_eq!(
        client.get_recipient_package_count(&Address::generate(&env)),
        0
    );
}

#[test]
fn test_get_recipient_package_count_returns_multiple_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    client.create_package(
        &admin,
        &1,
        &recipient,
        &UNIT,
        &token_client.address,
        &9999999,
        &Map::new(&env),
    );
    client.create_package(
        &admin,
        &2,
        &recipient,
        &UNIT,
        &token_client.address,
        &9999999,
        &Map::new(&env),
    );

    assert_eq!(client.get_recipient_package_count(&recipient), 2);
}

#[test]
fn test_extend_expiration_non_existent_package() {
    let env = Env::default();
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    assert_eq!(
        client.try_extend_expiration(&99, &10),
        Err(Ok(Error::PackageNotFound))
    );
}

#[test]
fn test_extend_expiration_unbounded_package() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    // expiry = 0 (unbounded)
    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &0,
        &Map::new(&env),
    );
    assert_eq!(
        client.try_extend_expiration(&1, &10),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_extend_expiration_multiple_extends() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));
    let client = AidEscrowClient::new(&env, &env.register(AidEscrow, ()));
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let initial = env.ledger().timestamp() + 1000;
    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &UNIT,
        &token_client.address,
        &initial,
        &Map::new(&env),
    );

    client.extend_expiration(&1, &100);
    client.extend_expiration(&1, &200);
    assert_eq!(client.get_package(&1).expires_at, initial + 300);
}
