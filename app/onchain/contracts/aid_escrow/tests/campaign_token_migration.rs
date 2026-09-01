//! Migration path for per-campaign, multi-token accounting (issue #975).
//!
//! `KEY_CAMPAIGN_TOKEN_LOCKED` / `KEY_CAMPAIGN_TOKEN_CLAIMED` are new as of
//! schema v2. A contract upgraded from v1 already has `Package` records (and
//! populated `KEY_TOTAL_LOCKED` / `KEY_TOTAL_CLAIMED` maps) for campaigns that
//! predate this feature; without a migration step those campaigns would
//! report zero for `get_campaign_token_locked` / `get_campaign_token_claimed`
//! even though they demonstrably hold or have claimed funds. These tests
//! drive the `migrate(1 -> 2)` backfill directly against that scenario.
//!
//! To simulate "existing data from before this feature shipped" without a
//! second contract binary, tests create packages normally (which — under the
//! current code — already populate the new maps live) and then reset those
//! two instance-storage keys to empty, mimicking the pre-migration state.
//! `migrate(&2)` must then reconstruct them purely from persisted `Package`
//! records.

#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, String, Symbol,
};

const UNIT: i128 = 10_000_000;

struct Fixture {
    env: Env,
    client: AidEscrowClient<'static>,
    contract_id: Address,
    admin: Address,
    recipient: Address,
}

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().with_mut(|li| li.timestamp = 1_000);
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        client.init(&admin);

        Fixture {
            env,
            client,
            contract_id,
            admin,
            recipient,
        }
    }

    fn new_funded_token(&self, amount: i128) -> TokenClient<'static> {
        let token_admin = Address::generate(&self.env);
        let (token, token_admin_client) = setup_token(&self.env, &token_admin);
        token_admin_client.mint(&self.admin, &amount);
        self.client.fund(&token.address, &self.admin, &amount);
        token
    }

    fn campaign(&self, campaign_ref: &str) -> String {
        String::from_str(&self.env, campaign_ref)
    }

    fn metadata_for(&self, campaign_ref: &str) -> Map<Symbol, String> {
        let mut metadata = Map::new(&self.env);
        metadata.set(
            Symbol::new(&self.env, "campaign_ref"),
            self.campaign(campaign_ref),
        );
        metadata
    }

    fn create_package(&self, id: u64, amount: i128, token: &Address, campaign_ref: &str) -> u64 {
        let expires_at = self.env.ledger().timestamp() + 86_400;
        self.client.create_package(
            &self.admin,
            &id,
            &self.recipient,
            &amount,
            token,
            &expires_at,
            &self.metadata_for(campaign_ref),
        )
    }

    /// Wipes the new per-campaign maps back to "never written", simulating a
    /// contract instance that predates this feature. The underlying
    /// `Package` records (and `KEY_TOTAL_LOCKED` / `KEY_TOTAL_CLAIMED`) are
    /// left untouched, exactly like a real pre-upgrade instance.
    fn reset_campaign_maps_to_pre_migration_state(&self) {
        self.env.as_contract(&self.contract_id, || {
            self.env
                .storage()
                .instance()
                .remove(&aid_escrow::KEY_CAMPAIGN_TOKEN_LOCKED);
            self.env
                .storage()
                .instance()
                .remove(&aid_escrow::KEY_CAMPAIGN_TOKEN_CLAIMED);
        });
    }
}

#[test]
fn migrate_backfills_locked_totals_from_existing_created_packages() {
    let f = Fixture::new();
    let token = f.new_funded_token(20 * UNIT);

    f.create_package(1, 5 * UNIT, &token.address, "camp-a");
    f.create_package(2, 3 * UNIT, &token.address, "camp-a");
    f.create_package(3, 7 * UNIT, &token.address, "camp-b");

    f.reset_campaign_maps_to_pre_migration_state();
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0,
        "campaign maps must read as empty immediately after the reset, proving the backfill (not live tracking) produces the post-migration values"
    );

    f.client.migrate(&2);

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        8 * UNIT,
        "backfill must sum every Created package tagged to camp-a"
    );
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-b"), &token.address),
        7 * UNIT
    );
    assert_eq!(
        f.client.get_total_locked(&token.address),
        15 * UNIT,
        "the global counter was never touched by the reset"
    );
}

#[test]
fn migrate_backfills_claimed_totals_from_existing_claimed_packages() {
    let f = Fixture::new();
    let token = f.new_funded_token(20 * UNIT);

    f.create_package(1, 5 * UNIT, &token.address, "camp-a");
    f.create_package(2, 3 * UNIT, &token.address, "camp-a");
    f.client.claim(&1);
    f.client.claim(&2);

    f.reset_campaign_maps_to_pre_migration_state();
    f.client.migrate(&2);

    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token.address),
        8 * UNIT
    );
    assert_eq!(f.client.get_total_claimed(&token.address), 8 * UNIT);
}

#[test]
fn migrate_leaves_untagged_packages_out_of_every_campaign() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);

    // No campaign_ref metadata at all.
    f.client.create_package(
        &f.admin,
        &1,
        &f.recipient,
        &(4 * UNIT),
        &token.address,
        &(f.env.ledger().timestamp() + 86_400),
        &Map::new(&f.env),
    );

    f.reset_campaign_maps_to_pre_migration_state();
    f.client.migrate(&2);

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(f.client.get_total_locked(&token.address), 4 * UNIT);
}

#[test]
fn migrate_is_idempotent_when_the_backfill_step_runs_once() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, 5 * UNIT, &token.address, "camp-a");

    f.reset_campaign_maps_to_pre_migration_state();
    f.client.migrate(&2);
    let after_first = f
        .client
        .get_campaign_token_locked(&f.campaign("camp-a"), &token.address);

    // A later migration step (2 -> 3) must not re-run the (1 -> 2) backfill
    // or double-count anything.
    f.client.migrate(&3);
    let after_second = f
        .client
        .get_campaign_token_locked(&f.campaign("camp-a"), &token.address);

    assert_eq!(after_first, 5 * UNIT);
    assert_eq!(after_second, 5 * UNIT);
}

#[test]
fn packages_created_after_migration_keep_accruing_correctly() {
    let f = Fixture::new();
    let token = f.new_funded_token(20 * UNIT);
    f.create_package(1, 5 * UNIT, &token.address, "camp-a");

    f.reset_campaign_maps_to_pre_migration_state();
    f.client.migrate(&2);

    // Post-migration activity must layer correctly on top of the backfill.
    f.create_package(2, 2 * UNIT, &token.address, "camp-a");
    f.client.claim(&1);

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        2 * UNIT,
        "package 1's locked amount moved to claimed; package 2 remains locked"
    );
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token.address),
        5 * UNIT
    );
}
