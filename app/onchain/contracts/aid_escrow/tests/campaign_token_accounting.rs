//! Tests for per-campaign, multi-token accounting (issue #975).
//!
//! `get_total_locked` / `get_total_claimed` are keyed by token only; these
//! tests cover the new `get_campaign_token_locked` / `get_campaign_token_claimed`
//! getters, which add a campaign dimension so a funder can ask what a single
//! campaign holds or has disbursed in a given token. They verify the counters
//! update on package creation ("fund"), claim, disburse, refund, and revoke,
//! that untagged packages never affect any campaign, and that per-campaign
//! totals sum back to the existing token-level totals.

#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, String, Symbol, Vec,
};

const UNIT: i128 = 10_000_000; // 1.0 token for a 7-decimal Stellar asset

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

struct Fixture {
    env: Env,
    client: AidEscrowClient<'static>,
    admin: Address,
    recipient: Address,
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
            admin,
            recipient,
        }
    }

    /// Registers a new Stellar asset and funds the escrow with `amount` of it.
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

    fn create_package(
        &self,
        id: u64,
        recipient: &Address,
        amount: i128,
        token: &Address,
        campaign_ref: Option<&str>,
    ) -> u64 {
        let expires_at = self.env.ledger().timestamp() + 86_400;
        let metadata = match campaign_ref {
            Some(c) => self.metadata_for(c),
            None => Map::new(&self.env),
        };
        self.client.create_package(
            &self.admin,
            &id,
            recipient,
            &amount,
            token,
            &expires_at,
            &metadata,
        )
    }

    fn advance(&self, seconds: u64) {
        let mut info = self.env.ledger().get();
        info.timestamp += seconds;
        self.env.ledger().set(info);
    }
}

// --- Defaults ---

#[test]
fn unknown_campaign_and_token_report_zero() {
    let f = Fixture::new();
    let token = Address::generate(&f.env);
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("never-seen"), &token),
        0
    );
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("never-seen"), &token),
        0
    );
}

// --- Fund (package creation) ---

#[test]
fn create_package_increments_campaign_token_locked() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 3 * UNIT, &token.address, Some("camp-a"));

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        3 * UNIT
    );
    assert_eq!(f.client.get_total_locked(&token.address), 3 * UNIT);
}

#[test]
fn untagged_package_does_not_affect_any_campaign() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 3 * UNIT, &token.address, None);

    // Global total_locked still reflects the untagged package...
    assert_eq!(f.client.get_total_locked(&token.address), 3 * UNIT);
    // ...but no campaign was ever tagged, so every campaign stays at zero.
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
}

#[test]
fn two_campaigns_sharing_a_token_are_tracked_independently() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 2 * UNIT, &token.address, Some("camp-a"));
    f.create_package(2, &f.recipient, 5 * UNIT, &token.address, Some("camp-b"));

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        2 * UNIT
    );
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-b"), &token.address),
        5 * UNIT
    );
    assert_eq!(f.client.get_total_locked(&token.address), 7 * UNIT);
}

#[test]
fn one_campaign_across_multiple_tokens_is_tracked_independently() {
    let f = Fixture::new();
    let token_a = f.new_funded_token(10 * UNIT);
    let token_b = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 2 * UNIT, &token_a.address, Some("camp-a"));
    f.create_package(2, &f.recipient, 4 * UNIT, &token_b.address, Some("camp-a"));

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token_a.address),
        2 * UNIT
    );
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token_b.address),
        4 * UNIT
    );
}

#[test]
fn batch_create_packages_updates_campaign_locked_per_campaign() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);

    let mut recipients = Vec::new(&f.env);
    recipients.push_back(f.recipient.clone());
    recipients.push_back(f.recipient.clone());
    recipients.push_back(f.recipient.clone());

    let mut amounts = Vec::new(&f.env);
    amounts.push_back(UNIT);
    amounts.push_back(2 * UNIT);
    amounts.push_back(3 * UNIT);

    let mut metadatas = Vec::new(&f.env);
    metadatas.push_back(f.metadata_for("camp-a"));
    metadatas.push_back(f.metadata_for("camp-a"));
    metadatas.push_back(f.metadata_for("camp-b"));

    f.client.batch_create_packages(
        &f.admin,
        &recipients,
        &amounts,
        &token.address,
        &86_400,
        &metadatas,
    );

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        3 * UNIT,
        "camp-a should hold the sum of its two packages"
    );
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-b"), &token.address),
        3 * UNIT
    );
    assert_eq!(f.client.get_total_locked(&token.address), 6 * UNIT);
}

// --- Claim ---

#[test]
fn claim_moves_campaign_amount_from_locked_to_claimed() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 3 * UNIT, &token.address, Some("camp-a"));

    f.client.claim(&1);

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token.address),
        3 * UNIT
    );
    assert_eq!(f.client.get_total_locked(&token.address), 0);
    assert_eq!(f.client.get_total_claimed(&token.address), 3 * UNIT);
}

#[test]
fn batch_claim_updates_campaign_claimed_per_campaign() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, UNIT, &token.address, Some("camp-a"));
    f.create_package(2, &f.recipient, 2 * UNIT, &token.address, Some("camp-b"));

    let mut ids = Vec::new(&f.env);
    ids.push_back(1u64);
    ids.push_back(2u64);
    f.client.batch_claim(&f.recipient, &ids);

    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token.address),
        UNIT
    );
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-b"), &token.address),
        2 * UNIT
    );
    assert_eq!(f.client.get_total_claimed(&token.address), 3 * UNIT);
}

// --- Expiry sweep ---

#[test]
fn sweep_expired_packages_decrements_campaign_locked() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);

    let expires_at = f.env.ledger().timestamp() + 100;
    let metadata = f.metadata_for("camp-a");
    f.client.create_package(
        &f.admin,
        &1,
        &f.recipient,
        &(3 * UNIT),
        &token.address,
        &expires_at,
        &metadata,
    );

    f.advance(200);
    let swept = f.client.sweep_expired_packages(&0);

    assert_eq!(swept, 1);
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0,
        "an automated expiry sweep must release campaign-locked funds exactly like a manual refund"
    );
    assert_eq!(f.client.get_total_locked(&token.address), 0);
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token.address),
        0,
        "an expiry sweep is not a claim"
    );
}

// --- Disburse ---

#[test]
fn disburse_decrements_campaign_locked_but_not_campaign_claimed() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 3 * UNIT, &token.address, Some("camp-a"));

    f.client.disburse(&1);

    // Locked releases exactly like the global counter...
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(f.client.get_total_locked(&token.address), 0);
    // ...but disburse has never counted as a "claim" for KEY_TOTAL_CLAIMED,
    // and the per-campaign counter preserves that so it stays summable.
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(f.client.get_total_claimed(&token.address), 0);
}

// --- Revoke ---

#[test]
fn revoke_decrements_campaign_locked() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 3 * UNIT, &token.address, Some("camp-a"));

    f.client.revoke(&1);

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(f.client.get_total_locked(&token.address), 0);
}

// --- Cancel ---

#[test]
fn cancel_package_decrements_campaign_locked() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 3 * UNIT, &token.address, Some("camp-a"));

    f.client.cancel_package(&1);

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(f.client.get_total_locked(&token.address), 0);
}

// --- Refund ---

#[test]
fn refund_decrements_campaign_locked_for_an_expired_package() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);

    let expires_at = f.env.ledger().timestamp() + 100;
    let metadata = f.metadata_for("camp-a");
    f.client.create_package(
        &f.admin,
        &1,
        &f.recipient,
        &(3 * UNIT),
        &token.address,
        &expires_at,
        &metadata,
    );

    f.advance(200);
    f.client.refund(&1);

    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(f.client.get_total_locked(&token.address), 0);
    // A refund of an expired (never claimed) package is not a claim either.
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token.address),
        0
    );
}

#[test]
fn refund_after_revoke_does_not_double_decrement_campaign_locked() {
    let f = Fixture::new();
    let token = f.new_funded_token(10 * UNIT);
    f.create_package(1, &f.recipient, 3 * UNIT, &token.address, Some("camp-a"));

    f.client.revoke(&1);
    f.client.refund(&1);

    // revoke() already unlocked the funds; refund() must not decrement (and
    // floor-clamp) the same campaign bucket a second time.
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token.address),
        0
    );
    assert_eq!(f.client.get_total_locked(&token.address), 0);
}

// --- Invariant: campaign totals sum to token totals ---

#[test]
fn campaign_totals_sum_to_token_totals_across_a_mixed_workflow() {
    let f = Fixture::new();
    let token_a = f.new_funded_token(100 * UNIT);
    let token_b = f.new_funded_token(100 * UNIT);
    let campaigns = ["camp-a", "camp-b", "camp-c"];

    // A mix of tokens, campaigns, and outcomes (claimed, disbursed, revoked,
    // refunded, and one untagged package that must never show up per-campaign).
    f.create_package(1, &f.recipient, 5 * UNIT, &token_a.address, Some("camp-a"));
    f.create_package(2, &f.recipient, 7 * UNIT, &token_a.address, Some("camp-b"));
    f.create_package(3, &f.recipient, 2 * UNIT, &token_a.address, Some("camp-a"));
    f.create_package(4, &f.recipient, 9 * UNIT, &token_b.address, Some("camp-c"));
    f.create_package(5, &f.recipient, 4 * UNIT, &token_b.address, Some("camp-a"));
    f.create_package(6, &f.recipient, UNIT, &token_a.address, None);

    f.client.claim(&1); // camp-a / token_a: locked -> claimed
    f.client.disburse(&2); // camp-b / token_a: locked -> released, not claimed
    f.client.revoke(&3); // camp-a / token_a: locked -> released, not claimed

    let expires_at = f.env.ledger().timestamp() + 100;
    let metadata = f.metadata_for("camp-c");
    f.client.create_package(
        &f.admin,
        &7,
        &f.recipient,
        &(3 * UNIT),
        &token_b.address,
        &expires_at,
        &metadata,
    );
    f.advance(200);
    f.client.refund(&7); // camp-c / token_b: expired, locked -> released

    // Package 6 is deliberately untagged: it must never be attributed to any
    // campaign, so the campaign-sum invariant only holds once its amount is
    // added back in for token_a. Every other package above carries a
    // campaign_ref, so token_b's campaign sum matches its token total exactly.
    let untagged_locked = [(&token_a, UNIT), (&token_b, 0)];

    for (token, untagged) in untagged_locked {
        let mut sum_locked: i128 = 0;
        let mut sum_claimed: i128 = 0;
        for campaign in campaigns {
            sum_locked += f
                .client
                .get_campaign_token_locked(&f.campaign(campaign), &token.address);
            sum_claimed += f
                .client
                .get_campaign_token_claimed(&f.campaign(campaign), &token.address);
        }

        assert_eq!(
            sum_locked + untagged,
            f.client.get_total_locked(&token.address),
            "campaign-locked sum plus untagged-package locked must equal the token-level locked total"
        );
        assert_eq!(
            sum_claimed,
            f.client.get_total_claimed(&token.address),
            "campaign-claimed sum must equal the token-level claimed total (no untagged claims here)"
        );
    }

    // Sanity on the concrete numbers, not just the invariant.
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token_a.address),
        0,
        "camp-a/token_a: package 1 claimed, package 3 revoked"
    );
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-a"), &token_a.address),
        5 * UNIT
    );
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-b"), &token_a.address),
        0,
        "camp-b/token_a: package 2 disbursed"
    );
    assert_eq!(
        f.client
            .get_campaign_token_claimed(&f.campaign("camp-b"), &token_a.address),
        0,
        "disburse never counts as a claim"
    );
    assert_eq!(
        f.client
            .get_campaign_token_locked(&f.campaign("camp-a"), &token_b.address),
        4 * UNIT,
        "camp-a/token_b: package 5 still Created"
    );
    // The untagged package (6) contributes to the token total but no campaign.
    assert_eq!(f.client.get_total_locked(&token_a.address), UNIT);
}
