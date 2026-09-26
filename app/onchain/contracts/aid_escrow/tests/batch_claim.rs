#![cfg(test)]

//! Tests for `batch_claim` (issue #961): claiming multiple packages in one
//! invocation, with per-package eligibility and explicit partial-success
//! semantics.

use aid_escrow::{
    AidEscrow, AidEscrowClient, ClaimStatus, Error, PackageStatus, MAX_BATCH_CLAIM_SIZE,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Vec,
};

const UNIT: i128 = 10_000_000; // 1.0 token for a 7-decimal Stellar asset

struct Fixture {
    env: Env,
    client: AidEscrowClient<'static>,
    admin: Address,
    token: TokenClient<'static>,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token = TokenClient::new(&env, &token_contract.address());
        let token_sac = StellarAssetClient::new(&env, &token_contract.address());

        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        client.init(&admin);

        token_sac.mint(&admin, &(1_000 * UNIT));
        client.fund(&token.address, &admin, &(1_000 * UNIT));

        Fixture {
            env,
            client,
            admin,
            token,
        }
    }

    fn create_package(&self, id: u64, recipient: &Address, amount: i128, expires_in: u64) {
        let expires_at = self.env.ledger().timestamp() + expires_in;
        self.client.create_package(
            &self.admin,
            &id,
            recipient,
            &amount,
            &self.token.address,
            &expires_at,
            &Map::new(&self.env),
        );
    }

    fn advance_time(&self, seconds: u64) {
        let mut info = self.env.ledger().get();
        info.timestamp += seconds;
        self.env.ledger().set(info);
    }

    fn ids(&self, values: &[u64]) -> Vec<u64> {
        let mut v = Vec::new(&self.env);
        for id in values {
            v.push_back(*id);
        }
        v
    }
}

#[test]
fn batch_claim_success_pays_out_every_package() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);
    f.create_package(1, &recipient, UNIT, 3_600);
    f.create_package(2, &recipient, 2 * UNIT, 3_600);
    f.create_package(3, &recipient, 3 * UNIT, 3_600);

    let results = f.client.batch_claim(&recipient, &f.ids(&[1, 2, 3]));

    assert_eq!(results.len(), 3);
    assert_eq!(results.get(0).unwrap().status, ClaimStatus::Success);
    assert_eq!(results.get(0).unwrap().amount, UNIT);
    assert_eq!(results.get(1).unwrap().status, ClaimStatus::Success);
    assert_eq!(results.get(1).unwrap().amount, 2 * UNIT);
    assert_eq!(results.get(2).unwrap().status, ClaimStatus::Success);
    assert_eq!(results.get(2).unwrap().amount, 3 * UNIT);

    assert_eq!(f.token.balance(&recipient), 6 * UNIT);
    assert_eq!(f.client.get_package(&1).status, PackageStatus::Claimed);
    assert_eq!(f.client.get_package(&2).status, PackageStatus::Claimed);
    assert_eq!(f.client.get_package(&3).status, PackageStatus::Claimed);
}

#[test]
fn batch_claim_partial_failure_does_not_abort_the_batch() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);
    let stranger = Address::generate(&f.env);

    f.create_package(10, &recipient, UNIT, 3_600); // claimable
    f.create_package(11, &recipient, UNIT, 3_600); // will be claimed ahead of the batch
    f.create_package(12, &stranger, UNIT, 3_600); // not the caller's package
    f.create_package(13, &recipient, UNIT, 1); // will expire before the batch runs

    f.client.claim(&11);
    f.advance_time(10); // pushes package 13 past its expiry

    let results = f
        .client
        .batch_claim(&recipient, &f.ids(&[10, 11, 12, 13, 999]));

    assert_eq!(results.len(), 5);
    assert_eq!(results.get(0).unwrap().status, ClaimStatus::Success);
    assert_eq!(results.get(0).unwrap().amount, UNIT);
    assert_eq!(results.get(1).unwrap().status, ClaimStatus::NotActive);
    assert_eq!(results.get(2).unwrap().status, ClaimStatus::Unauthorized);
    assert_eq!(results.get(3).unwrap().status, ClaimStatus::Expired);
    assert_eq!(results.get(4).unwrap().status, ClaimStatus::NotFound);

    // Only package 10 was paid out by this batch (package 11 was already paid
    // by the earlier individual claim); accounting reflects exactly that.
    assert_eq!(f.token.balance(&recipient), 2 * UNIT);
    assert_eq!(f.client.get_package(&10).status, PackageStatus::Claimed);
    assert_eq!(f.client.get_package(&12).status, PackageStatus::Created);
    assert_eq!(f.client.get_package(&13).status, PackageStatus::Created);
}

#[test]
fn batch_claim_rejects_batches_above_the_max_size() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);

    let mut ids = Vec::new(&f.env);
    for i in 0..(MAX_BATCH_CLAIM_SIZE + 1) {
        ids.push_back(i as u64);
    }

    let result = f.client.try_batch_claim(&recipient, &ids);
    assert_eq!(result, Err(Ok(Error::BatchTooLarge)));
}

#[test]
fn batch_claim_allows_exactly_the_max_size() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);

    let mut ids = Vec::new(&f.env);
    for i in 0..MAX_BATCH_CLAIM_SIZE as u64 {
        f.create_package(i, &recipient, UNIT, 3_600);
        ids.push_back(i);
    }

    let results = f.client.batch_claim(&recipient, &ids);
    assert_eq!(results.len(), MAX_BATCH_CLAIM_SIZE);
    for r in results.iter() {
        assert_eq!(r.status, ClaimStatus::Success);
    }
}

#[test]
fn batch_claim_respects_the_claim_pause_switch() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);
    f.create_package(20, &recipient, UNIT, 3_600);

    f.client.pause_action(&symbol_short!("claim"));

    let result = f.client.try_batch_claim(&recipient, &f.ids(&[20]));
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
    assert_eq!(f.client.get_package(&20).status, PackageStatus::Created);
}

#[test]
fn batch_claim_with_empty_ids_returns_empty_results() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);

    let results = f.client.batch_claim(&recipient, &Vec::new(&f.env));
    assert_eq!(results.len(), 0);
}

#[test]
fn batch_claim_duplicate_id_only_pays_out_once() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);
    f.create_package(30, &recipient, UNIT, 3_600);

    let results = f.client.batch_claim(&recipient, &f.ids(&[30, 30]));

    assert_eq!(results.get(0).unwrap().status, ClaimStatus::Success);
    assert_eq!(results.get(1).unwrap().status, ClaimStatus::NotActive);
    assert_eq!(f.token.balance(&recipient), UNIT);
}

#[test]
fn batch_claim_pays_an_authorised_delegate() {
    let f = Fixture::new();
    let recipient = Address::generate(&f.env);
    let delegate = Address::generate(&f.env);
    f.create_package(40, &recipient, UNIT, 3_600);
    f.client.set_delegate(&f.admin, &40, &delegate);

    let results = f.client.batch_claim(&delegate, &f.ids(&[40]));

    assert_eq!(results.get(0).unwrap().status, ClaimStatus::Success);
    assert_eq!(f.token.balance(&delegate), UNIT);
    assert_eq!(f.client.get_package(&40).status, PackageStatus::Claimed);
}
