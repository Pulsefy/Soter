#![cfg(test)]

//! Coverage for the optional per-recipient claim cooldown (issue #966).

use aid_escrow::{AidEscrow, AidEscrowClient, ClaimStatus, Config, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Vec,
};

const UNIT: i128 = 10_000_000;

struct Fixture {
    env: Env,
    client: AidEscrowClient<'static>,
    admin: Address,
    token: TokenClient<'static>,
}

impl Fixture {
    fn new(cooldown: u64) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token = TokenClient::new(&env, &token_contract.address());
        let token_sac = StellarAssetClient::new(&env, &token_contract.address());
        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        client.init(&admin);
        client.set_config(&Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
            claim_cooldown: cooldown,
        });
        token_sac.mint(&admin, &(100 * UNIT));
        client.fund(&token.address, &admin, &(100 * UNIT));
        Self {
            env,
            client,
            admin,
            token,
        }
    }

    fn create(&self, id: u64, recipient: &Address) {
        self.client.create_package(
            &self.admin,
            &id,
            recipient,
            &UNIT,
            &self.token.address,
            &(self.env.ledger().timestamp() + 10_000),
            &Map::new(&self.env),
        );
    }

    fn advance(&self, seconds: u64) {
        let mut info = self.env.ledger().get();
        info.timestamp += seconds;
        self.env.ledger().set(info);
    }
}

#[test]
fn cooldown_rejects_claim_inside_window_and_allows_claim_at_boundary() {
    let f = Fixture::new(60);
    let recipient = Address::generate(&f.env);
    f.create(1, &recipient);
    f.create(2, &recipient);

    f.client.claim(&1);
    assert_eq!(f.client.try_claim(&2), Err(Ok(Error::ClaimCooldownActive)));
    assert_eq!(f.client.get_package(&2).status, PackageStatus::Created);

    f.advance(60);
    f.client.claim(&2);
    assert_eq!(f.client.get_package(&2).status, PackageStatus::Claimed);
}

#[test]
fn disabled_cooldown_allows_consecutive_claims() {
    let f = Fixture::new(0);
    let recipient = Address::generate(&f.env);
    f.create(1, &recipient);
    f.create(2, &recipient);

    f.client.claim(&1);
    f.client.claim(&2);
    assert_eq!(f.token.balance(&recipient), 2 * UNIT);
}

#[test]
fn batch_claim_reports_cooldown_per_item_without_aborting() {
    let f = Fixture::new(60);
    let recipient = Address::generate(&f.env);
    f.create(1, &recipient);
    f.create(2, &recipient);
    let mut ids = Vec::new(&f.env);
    ids.push_back(1);
    ids.push_back(2);

    let results = f.client.batch_claim(&recipient, &ids);
    assert_eq!(results.get(0).unwrap().status, ClaimStatus::Success);
    assert_eq!(results.get(1).unwrap().status, ClaimStatus::CooldownActive);
    assert_eq!(f.client.get_package(&1).status, PackageStatus::Claimed);
    assert_eq!(f.client.get_package(&2).status, PackageStatus::Created);
}
