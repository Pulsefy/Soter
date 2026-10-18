#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, Env, Map, Symbol,
};

const UNIT: i128 = 10_000_000;

fn setup_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    env
}

struct RelayerTest {
    env: Env,
    client: AidEscrowClient<'static>,
    admin: Address,
    recipient: Address,
    delegate: Address,
    relayer: Address,
    stranger: Address,
    token: Address,
    token_client: TokenClient<'static>,
    token_admin_client: StellarAssetClient<'static>,
}

impl RelayerTest {
    fn new() -> Self {
        let env = setup_env();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let delegate = Address::generate(&env);
        let relayer = Address::generate(&env);
        let stranger = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_contract.address();
        let token_client = TokenClient::new(&env, &token);
        let token_admin_client = StellarAssetClient::new(&env, &token);

        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        client.init(&admin);

        token_admin_client.mint(&admin, &(10 * UNIT));
        client.fund(&token, &admin, &(10 * UNIT));

        Self {
            env,
            client,
            admin,
            recipient,
            delegate,
            relayer,
            stranger,
            token,
            token_client,
            token_admin_client,
        }
    }

    fn fund_contract(&self, amount: i128) {
        self.token_admin_client.mint(&self.client.address, &amount);
    }

    fn create_package(&self, id: u64) {
        let metadata = Map::new(&self.env);
        self.client.create_package(
            &self.admin,
            &id,
            &self.recipient,
            &UNIT,
            &self.token,
            &(self.now() + 86400),
            &metadata,
        );
    }

    fn create_expiring_package(&self, id: u64, ttl: u64) {
        let metadata = Map::new(&self.env);
        self.client.create_package(
            &self.admin,
            &id,
            &self.recipient,
            &UNIT,
            &self.token,
            &(self.now() + ttl),
            &metadata,
        );
    }

    fn advance_time(&self, seconds: u64) {
        let mut info = self.env.ledger().get();
        info.timestamp += seconds;
        self.env.ledger().set(info);
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    fn balance_of(&self, address: &Address) -> i128 {
        self.token_client.balance(address)
    }
}

#[test]
fn relayed_claim_succeeds() {
    let t = RelayerTest::new();
    t.create_package(1);

    assert_eq!(t.balance_of(&t.recipient), 0);

    t.client.claim_with_relayer(&1, &t.recipient, &t.relayer);

    let pkg = t.client.get_package(&1);
    assert_eq!(pkg.status, PackageStatus::Claimed);
    assert_eq!(t.balance_of(&t.recipient), UNIT);
}

#[test]
fn relayed_claim_emits_separate_event() {
    let t = RelayerTest::new();
    t.create_package(1);

    t.client.claim_with_relayer(&1, &t.recipient, &t.relayer);

    let pkg = t.client.get_package(&1);
    assert_eq!(pkg.status, PackageStatus::Claimed);
}

#[test]
fn relayed_claim_fails_on_replay() {
    let t = RelayerTest::new();
    t.create_package(1);

    t.client.claim_with_relayer(&1, &t.recipient, &t.relayer);

    let result = t
        .client
        .try_claim_with_relayer(&1, &t.recipient, &t.relayer);
    assert_eq!(result, Err(Ok(Error::PackageNotActive)));
}

#[test]
fn relayed_claim_fails_for_stranger() {
    let t = RelayerTest::new();
    t.create_package(1);

    let result = t.client.try_claim_with_relayer(&1, &t.stranger, &t.relayer);
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));

    let pkg = t.client.get_package(&1);
    assert_eq!(pkg.status, PackageStatus::Created);
}

#[test]
fn relayed_claim_fails_for_expired_package() {
    let t = RelayerTest::new();
    t.create_expiring_package(1, 1000);
    t.advance_time(1001);

    let result = t
        .client
        .try_claim_with_relayer(&1, &t.recipient, &t.relayer);
    assert_eq!(result, Err(Ok(Error::PackageExpired)));
}

#[test]
fn relayed_claim_fails_for_nonexistent_package() {
    let t = RelayerTest::new();

    let result = t
        .client
        .try_claim_with_relayer(&999, &t.recipient, &t.relayer);
    assert_eq!(result, Err(Ok(Error::PackageNotFound)));
}

#[test]
fn relayed_claim_fails_for_merkle_protected_package() {
    let t = RelayerTest::new();

    let claimant = Address::generate(&t.env);
    let root_hex = {
        let addr = claimant.to_string();
        let len = addr.len() as usize;
        let mut raw = [0u8; 96];
        addr.copy_into_slice(&mut raw[..len]);
        let mut data = Bytes::new(&t.env);
        for b in raw[..len].iter() {
            data.push_back(*b);
        }
        let digest = t.env.crypto().sha256(&data);
        let hash = digest.to_array();
        let mut out = std::string::String::with_capacity(64);
        for b in hash {
            out.push_str(&format!("{:02x}", b));
        }
        out
    };

    let mut metadata = Map::new(&t.env);
    metadata.set(
        Symbol::new(&t.env, "merkle_root"),
        soroban_sdk::String::from_str(&t.env, &root_hex),
    );

    t.fund_contract(UNIT);
    t.client.create_package(
        &t.admin,
        &42,
        &Address::generate(&t.env),
        &UNIT,
        &t.token,
        &(t.now() + 3600),
        &metadata,
    );

    let result = t.client.try_claim_with_relayer(&42, &claimant, &t.relayer);
    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}

#[test]
fn relayed_claim_fails_when_paused() {
    let t = RelayerTest::new();
    t.create_package(1);

    t.client.pause_action(&symbol_short!("claim"));

    let result = t
        .client
        .try_claim_with_relayer(&1, &t.recipient, &t.relayer);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn relayed_claim_via_delegate_succeeds() {
    let t = RelayerTest::new();
    t.create_package(1);

    t.client.set_delegate(&t.admin, &1, &t.delegate);

    t.client.claim_with_relayer(&1, &t.delegate, &t.relayer);

    let pkg = t.client.get_package(&1);
    assert_eq!(pkg.status, PackageStatus::Claimed);
    assert_eq!(t.balance_of(&t.delegate), UNIT);
}

#[test]
fn relayed_claim_via_expired_delegate_fails() {
    let t = RelayerTest::new();
    t.create_package(1);

    let expires_at = t.now() + 100;
    t.client
        .set_delegate_with_expiry(&t.admin, &1, &t.delegate, &expires_at);

    t.advance_time(101);

    let result = t.client.try_claim_with_relayer(&1, &t.delegate, &t.relayer);
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));

    let pkg = t.client.get_package(&1);
    assert_eq!(pkg.status, PackageStatus::Created);
}

#[test]
fn relayed_claim_fails_when_already_claimed_by_direct_claim() {
    let t = RelayerTest::new();
    t.create_package(1);

    t.client.claim(&1);

    let result = t
        .client
        .try_claim_with_relayer(&1, &t.recipient, &t.relayer);
    assert_eq!(result, Err(Ok(Error::PackageNotActive)));
}
