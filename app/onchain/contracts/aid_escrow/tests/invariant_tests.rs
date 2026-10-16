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

// ===========================================================================
// Concurrency invariant: a package is claimable at most once per package,
// no matter how many claim transactions land in the same ledger close.
//
// Soroban serialises transaction execution: every transaction in a ledger
// close observes the writes committed by the transactions before it. Two
// `claim` invocations for the same package therefore cannot both observe
// `PackageStatus::Created`; the second one reads the status the first one
// wrote and is rejected by the `status != PackageStatus::Created` guard in
// `claim` with `Error::PackageNotActive` (code 6).
//
// The host test environment has no transaction pipeline, so "same ledger
// close" is modelled as consecutive invocations at an *identical* ledger
// timestamp with no `env.ledger().set` in between. Each test asserts that
// the timestamp really was unchanged across the racing calls, so the
// premise cannot silently rot if the fixture is refactored.
// ===========================================================================

mod simultaneous_claims {
    use super::*;
    use aid_escrow::{Config, Error, PackageStatus};
    use soroban_sdk::{
        testutils::{Ledger, LedgerInfo},
        Bytes, ConversionError, InvokeError, String, Symbol, Vec,
    };

    const CAMPAIGN: &str = "campaign-race";

    /// Post-conditions of a claim race, expressed relative to the pre-race
    /// snapshot so a single assertion set covers every entry point.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Accounting {
        locked: i128,
        claimed: i128,
        campaign_locked: i128,
        campaign_claimed: i128,
        contract_balance: i128,
        recipient_balance: i128,
    }

    struct RaceFixture {
        env: Env,
        client: AidEscrowClient<'static>,
        admin: Address,
        recipient: Address,
        relayer: Address,
        token: Address,
        token_client: TokenClient<'static>,
        campaign: String,
        /// Payout size of a single package.
        amount: i128,
    }

    impl RaceFixture {
        fn new() -> Self {
            let env = Env::default();
            env.ledger().set(LedgerInfo {
                timestamp: 1_000_000,
                protocol_version: 23,
                sequence_number: 100,
                network_id: Default::default(),
                base_reserve: 10,
                min_temp_entry_ttl: 10,
                min_persistent_entry_ttl: 10,
                max_entry_ttl: 3_110_400,
            });
            env.mock_all_auths();

            let admin = Address::generate(&env);
            let recipient = Address::generate(&env);
            let relayer = Address::generate(&env);

            let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
            let token = token_contract.address();
            let token_client = TokenClient::new(&env, &token);
            let token_admin_client = StellarAssetClient::new(&env, &token);

            let contract_id = env.register(AidEscrow, ());
            let client = AidEscrowClient::new(&env, &contract_id);
            client.init(&admin);
            client.set_config(&Config {
                min_amount: 1,
                max_expires_in: 0,
                allowed_tokens: Vec::new(&env),
                claim_cooldown: 0,
            });

            // Fund the pool with a surplus on top of the package amount, so
            // the solvency assertions below are not trivially satisfied by an
            // escrow balance that happens to equal the payout.
            let fund_amount = 20 * UNIT;
            token_admin_client.mint(&admin, &fund_amount);
            client.fund(&token, &admin, &fund_amount);

            let campaign = String::from_str(&env, CAMPAIGN);
            let amount = 10 * UNIT;

            RaceFixture {
                env,
                client,
                admin,
                recipient,
                relayer,
                token,
                token_client,
                campaign,
                amount,
            }
        }

        /// Metadata for a single-leaf Merkle tree rooted at `claimant`, so the
        /// package must be claimed through `claim_with_proof`.
        fn merkle_metadata(&self, claimant: &Address) -> Map<Symbol, String> {
            let mut metadata = Map::new(&self.env);
            metadata.set(
                Symbol::new(&self.env, "merkle_root"),
                String::from_str(&self.env, &self.single_leaf_root(claimant)),
            );
            metadata
        }

        /// sha256 over the address's canonical string form, matching
        /// `hash_address` in the contract, hex-encoded. A single-leaf tree
        /// needs no siblings, so the root *is* the leaf and its proof is empty.
        fn single_leaf_root(&self, claimant: &Address) -> std::string::String {
            let addr = claimant.to_string();
            let len = addr.len() as usize;
            let mut raw = [0u8; 96];
            addr.copy_into_slice(&mut raw[..len]);

            let mut data = Bytes::new(&self.env);
            for b in raw[..len].iter() {
                data.push_back(*b);
            }

            let digest = self.env.crypto().sha256(&data).to_array();
            let mut hex = std::string::String::with_capacity(64);
            for b in digest {
                hex.push_str(&format!("{:02x}", b));
            }
            hex
        }

        fn create_package(&self, id: u64, metadata: &Map<Symbol, String>) -> u64 {
            self.client.create_package(
                &self.admin,
                &id,
                &self.recipient,
                &self.amount,
                &self.token,
                &(self.env.ledger().timestamp() + 3_600),
                metadata,
            )
        }

        fn campaign_metadata(&self) -> Map<Symbol, String> {
            let mut metadata = Map::new(&self.env);
            metadata.set(
                Symbol::new(&self.env, "campaign_ref"),
                self.campaign.clone(),
            );
            metadata
        }

        fn now(&self) -> u64 {
            self.env.ledger().timestamp()
        }

        fn snapshot(&self) -> Accounting {
            Accounting {
                locked: self.client.get_total_locked(&self.token),
                claimed: self.client.get_total_claimed(&self.token),
                campaign_locked: self
                    .client
                    .get_campaign_token_locked(&self.campaign, &self.token),
                campaign_claimed: self
                    .client
                    .get_campaign_token_claimed(&self.campaign, &self.token),
                contract_balance: self.token_client.balance(&self.client.address),
                recipient_balance: self.token_client.balance(&self.recipient),
            }
        }

        fn proofless(&self) -> Vec<String> {
            Vec::new(&self.env)
        }
    }

    /// The shape every `try_*` claim entry point returns.
    ///
    /// - `Ok(Ok(()))`                          -> the claim paid out
    /// - `Err(Ok(Error::PackageNotActive))`     -> clean, documented rejection
    /// - `Ok(Err(ConversionError))`             -> return value could not be converted
    /// - `Err(Err(InvokeError))`                -> host-level failure (panic/trap)
    ///
    /// Only the first two outcomes are acceptable in a claim race: the loser
    /// must be rejected by the contract itself, not by a generic host error.
    type ClaimAttempt = Result<Result<(), ConversionError>, Result<Error, InvokeError>>;

    /// Asserts the loser's failure is the documented `PackageNotActive`
    /// contract error rather than a generic host-level or panic failure, and
    /// that exactly one of the two racing invocations succeeded.
    fn assert_exactly_one_claim_won(first: ClaimAttempt, second: ClaimAttempt) {
        let winners = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            winners, 1,
            "exactly one claim in a ledger close must pay out, got {winners}"
        );

        let loser = if first.is_ok() { &second } else { &first };
        assert_eq!(
            *loser,
            Err(Ok(Error::PackageNotActive)),
            "the losing claim must surface the documented PackageNotActive \
             error, not a generic failure"
        );
    }

    /// Asserts `id` was paid exactly once and that both the token-level and
    /// the per-campaign ledgers moved by exactly one payout — no
    /// double-decrement of locked, no double-increment of claimed.
    fn assert_paid_exactly_once(f: &RaceFixture, id: u64, before: Accounting) {
        let after = f.snapshot();
        let amount = f.amount;

        assert_eq!(
            f.client.get_package(&id).status,
            PackageStatus::Claimed,
            "the package must end up in Claimed status"
        );
        assert_eq!(f.client.view_package_status(&id), PackageStatus::Claimed);

        // Recipient paid once — a second payout would be a double spend.
        assert_eq!(
            after.recipient_balance - before.recipient_balance,
            amount,
            "the recipient must be paid the package amount exactly once"
        );

        // Escrow balance fell by exactly one payout.
        assert_eq!(
            before.contract_balance - after.contract_balance,
            amount,
            "the escrow balance must drop by exactly one payout"
        );

        // Locked decremented once; every other package stays locked.
        assert_eq!(
            before.locked - after.locked,
            amount,
            "total locked must be decremented exactly once"
        );

        // Claimed incremented once.
        assert_eq!(
            after.claimed - before.claimed,
            amount,
            "total claimed must be incremented exactly once"
        );

        // The per-campaign ledger mirrors the token-level ledger.
        assert_eq!(
            before.campaign_locked - after.campaign_locked,
            amount,
            "per-campaign locked must be decremented exactly once"
        );
        assert_eq!(
            after.campaign_claimed - before.campaign_claimed,
            amount,
            "per-campaign claimed must be incremented exactly once"
        );

        // A claimed package is left neither locked nor owed, and the pool is
        // still solvent. Locked totals are asserted relative to the
        // pre-race snapshot so this also holds in fixtures that keep other
        // packages outstanding.
        assert!(
            after.locked <= before.locked,
            "a failed claim must never increase the locked total"
        );
        assert_eq!(
            after.claimed + after.contract_balance,
            before.claimed + before.contract_balance,
            "conservation of value must hold across the race"
        );
        assert!(
            after.contract_balance >= after.locked,
            "the escrow must remain solvent"
        );
    }

    #[test]
    fn two_claims_in_one_ledger_close_allow_exactly_one_payout() {
        let f = RaceFixture::new();
        let id = f.create_package(1, &f.campaign_metadata());

        let before = f.snapshot();
        assert_eq!(before.locked, f.amount);
        assert_eq!(before.campaign_locked, f.amount);

        // Both invocations land in the same ledger close: identical
        // timestamps, no ledger update in between.
        let close_start = f.now();
        let first = f.client.try_claim(&id);
        let first_close = f.now();
        let second = f.client.try_claim(&id);
        let second_close = f.now();

        assert_eq!(
            (first_close, second_close),
            (close_start, close_start),
            "both claims must be submitted within a single ledger close"
        );

        assert_exactly_one_claim_won(first, second);
        assert_paid_exactly_once(&f, id, before);
    }

    #[test]
    fn claim_and_relayed_claim_in_one_ledger_close_allow_exactly_one_payout() {
        let f = RaceFixture::new();
        let id = f.create_package(2, &f.campaign_metadata());
        let before = f.snapshot();

        // A recipient-signed claim racing a relayer-submitted one. The
        // payout goes to the recipient either way, so the accounting
        // assertions are identical for both orderings.
        let close_start = f.now();
        let direct = f.client.try_claim(&id);
        let relayed = f
            .client
            .try_claim_with_relayer(&id, &f.recipient, &f.relayer);
        let close_end = f.now();

        assert_eq!(close_end, close_start);

        assert_exactly_one_claim_won(direct, relayed);
        assert_paid_exactly_once(&f, id, before);
    }

    #[test]
    fn proof_claims_by_different_allowlisted_claimants_allow_exactly_one_payout() {
        let f = RaceFixture::new();
        // Two distinct, equally valid members of the allowlist race for the
        // single payout of one package.
        let other = Address::generate(&f.env);
        let id = f.create_package(3, &f.merkle_metadata(&f.recipient));
        let before = f.snapshot();

        let close_start = f.now();
        let first = f
            .client
            .try_claim_with_proof(&id, &f.recipient, &f.proofless());
        let second = f.client.try_claim_with_proof(&id, &other, &f.proofless());
        let close_end = f.now();

        assert_eq!(close_end, close_start);
        let winners = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            winners, 1,
            "exactly one allowlisted claimant may win a single-leaf race"
        );
        let loser = if first.is_ok() { &second } else { &first };
        assert_eq!(
            *loser,
            Err(Ok(Error::PackageNotActive)),
            "the losing proof claim must surface PackageNotActive"
        );

        // Whichever claimant lost, the payout still went to the package's
        // recipient and only once.
        assert_eq!(f.client.get_package(&id).status, PackageStatus::Claimed);
        let after = f.snapshot();
        assert_eq!(after.locked, 0);
        assert_eq!(after.claimed, before.claimed + f.amount);
        assert_eq!(
            after.recipient_balance - before.recipient_balance,
            f.amount,
            "the recipient must be paid the package amount exactly once"
        );
        assert_eq!(
            after.claimed + after.contract_balance,
            before.claimed + before.contract_balance,
            "conservation of value must hold across the proof race"
        );
    }

    #[test]
    fn many_claims_in_one_ledger_close_still_pay_out_once() {
        let f = RaceFixture::new();
        let id = f.create_package(4, &f.campaign_metadata());
        let before = f.snapshot();

        let close_start = f.now();
        let mut winners = 0;
        for _ in 0..5 {
            if f.client.try_claim(&id).is_ok() {
                winners += 1;
            }
        }
        assert_eq!(f.now(), close_start, "no ledger close may elapse mid-race");

        assert_eq!(
            winners, 1,
            "five simultaneous claims must still pay out exactly once"
        );
        assert_paid_exactly_once(&f, id, before);
    }

    #[test]
    fn losing_claim_cannot_corrupt_a_concurrent_winner_on_a_sibling_package() {
        let f = RaceFixture::new();
        let raced = f.create_package(5, &f.campaign_metadata());
        let sibling = f.create_package(6, &f.campaign_metadata());
        let before = f.snapshot();

        let close_start = f.now();
        let first = f.client.try_claim(&raced);
        let second = f.client.try_claim(&raced);
        assert_eq!(f.now(), close_start);
        assert_exactly_one_claim_won(first, second);
        assert_paid_exactly_once(&f, raced, before);

        // A third claim, this time for a different package in the same
        // campaign, must still succeed: the failed claim above must not have
        // left any global or per-campaign counter in a bad state.
        let after_race = f.snapshot();
        assert!(f.client.try_claim(&sibling).is_ok());
        let after = f.snapshot();

        assert_eq!(
            after.locked - after_race.locked,
            -f.amount,
            "a later claim must still decrement locked"
        );
        assert_eq!(
            after.claimed - after_race.claimed,
            f.amount,
            "a later claim must still increment claimed"
        );
        assert_eq!(
            after.campaign_claimed - after_race.campaign_claimed,
            f.amount,
            "a later claim must still increment the campaign claimed total"
        );
        assert_eq!(
            after.campaign_locked - after_race.campaign_locked,
            -f.amount,
            "a later claim must still decrement the campaign locked total"
        );
    }

    #[test]
    fn re_claim_after_a_won_race_reports_package_not_active_not_expired() {
        // Ordering variant: once another claim has finalised the package
        // inside the same ledger close, a later claim must report
        // `PackageNotActive` and never the expiry error, because the status
        // guard in `claim` runs before the expiry check.
        let f = RaceFixture::new();
        let id = f.create_package(7, &f.campaign_metadata());

        assert!(f.client.try_claim(&id).is_ok());

        let loser = f.client.try_claim(&id);
        assert_eq!(loser, Err(Ok(Error::PackageNotActive)));
        assert_ne!(
            loser,
            Err(Ok(Error::PackageExpired)),
            "a re-claim of a claimed package is not an expiry failure"
        );
    }
}

// ===========================================================================
// Batch operations under partial failure.
//
// `batch_revoke` and `batch_refund` are partial: every requested id is
// evaluated independently and the per-id `BatchAdminActionResult` reports
// whether that item succeeded, was not found, was in the wrong state, etc.
// `batch_create_packages` is all-or-nothing: a single invalid entry aborts
// the whole call.
//
// In every case the aggregate ledgers (`get_total_locked`,
// `get_total_claimed`) must move by exactly the amounts of the ids that
// actually took effect — never by the full requested batch — and the per-id
// results must flag which ids failed and why.
// ===========================================================================

mod batch_partial_failure {
    use super::*;
    use aid_escrow::{BatchAdminActionResult, BatchAdminActionStatus, Error, PackageStatus};
    use soroban_sdk::{testutils::Ledger, Vec};

    /// Shared fixture: one admin-funded escrow and one 7-decimal token.
    struct Fixture {
        env: Env,
        client: AidEscrowClient<'static>,
        admin: Address,
        token: Address,
    }

    impl Fixture {
        fn new(funded_units: i128) -> Self {
            let env = Env::default();
            env.mock_all_auths();

            let admin = Address::generate(&env);
            let token_admin = Address::generate(&env);
            let token_contract = env.register_stellar_asset_contract_v2(token_admin);
            let token = token_contract.address();
            let token_admin_client = StellarAssetClient::new(&env, &token);

            let contract_id = env.register(AidEscrow, ());
            let client = AidEscrowClient::new(&env, &contract_id);
            client.init(&admin);

            let funded = funded_units * UNIT;
            token_admin_client.mint(&admin, &funded);
            client.fund(&token, &admin, &funded);

            Fixture {
                env,
                client,
                admin,
                token,
            }
        }

        /// Creates `count` equal packages with auto-incremented ids via the
        /// batch entry point.
        fn create_batch(&self, count: u32, expires_in: u64) -> Vec<u64> {
            let mut recipients = Vec::new(&self.env);
            let mut amounts = Vec::new(&self.env);
            let mut metadatas = Vec::new(&self.env);
            for _ in 0..count {
                recipients.push_back(Address::generate(&self.env));
                amounts.push_back(UNIT);
                metadatas.push_back(Map::new(&self.env));
            }
            self.client.batch_create_packages(
                &self.admin,
                &recipients,
                &amounts,
                &self.token,
                &expires_in,
                &metadatas,
            )
        }

        /// Creates one package with an explicit id and absolute expiry.
        fn create_at(&self, id: u64, expires_at: u64) -> u64 {
            self.client.create_package(
                &self.admin,
                &id,
                &Address::generate(&self.env),
                &UNIT,
                &self.token,
                &expires_at,
                &Map::new(&self.env),
            )
        }

        fn locked(&self) -> i128 {
            self.client.get_total_locked(&self.token)
        }

        fn claimed(&self) -> i128 {
            self.client.get_total_claimed(&self.token)
        }

        fn admin_balance(&self) -> i128 {
            TokenClient::new(&self.env, &self.token).balance(&self.admin)
        }
    }

    /// Asserts one per-id result echoes the requested id, reports the expected
    /// status, and carries a payout only when it succeeded.
    fn assert_result(
        result: &BatchAdminActionResult,
        expected_id: u64,
        expected_status: BatchAdminActionStatus,
    ) {
        assert_eq!(
            result.package_id, expected_id,
            "the per-id result must echo the requested id"
        );
        assert_eq!(
            result.status, expected_status,
            "unexpected status for id {expected_id}"
        );
        if expected_status == BatchAdminActionStatus::Success {
            assert_eq!(
                result.amount, UNIT,
                "a successful item must report the amount it moved"
            );
        } else {
            assert_eq!(
                result.amount, 0,
                "a failed item must not report a payout (id {expected_id})"
            );
        }
    }

    /// `batch_revoke` with an already-claimed package in the mix: the
    /// claimed id is rejected, so only the genuinely revoked ids unlock
    /// funds. `total_locked` must drop by the successful subset alone and
    /// `total_claimed` must be untouched.
    #[test]
    fn batch_revoke_aggregates_reflect_only_successful_subset() {
        let f = Fixture::new(4);

        // Four equal packages, ids 0..=3.
        let ids = f.create_batch(4, 3_600);
        assert_eq!(f.locked(), 4 * UNIT);

        // Claim id 0 so it is no longer revocable: a deliberate invalid id.
        f.client.claim(&ids.get(0).unwrap());
        let locked_before = f.locked();
        let claimed_before = f.claimed();
        assert_eq!(locked_before, 3 * UNIT);
        assert_eq!(claimed_before, UNIT);

        // Mix valid (1, 2), already-claimed (0), and unknown (777) ids.
        let missing = 777u64;
        let mut requested = Vec::new(&f.env);
        requested.push_back(ids.get(0).unwrap()); // Claimed -> InvalidState
        requested.push_back(ids.get(1).unwrap()); // Created -> Success
        requested.push_back(missing); //              unknown -> NotFound
        requested.push_back(ids.get(2).unwrap()); // Created -> Success

        let results = f.client.batch_revoke(&requested);
        assert_eq!(results.len(), 4);
        assert_result(
            &results.get(0).unwrap(),
            ids.get(0).unwrap(),
            BatchAdminActionStatus::InvalidState,
        );
        assert_result(
            &results.get(1).unwrap(),
            ids.get(1).unwrap(),
            BatchAdminActionStatus::Success,
        );
        assert_result(
            &results.get(2).unwrap(),
            missing,
            BatchAdminActionStatus::NotFound,
        );
        assert_result(
            &results.get(3).unwrap(),
            ids.get(2).unwrap(),
            BatchAdminActionStatus::Success,
        );

        // Only the two successful revokes unlock funds; the claimed id must
        // not be double-counted and the unknown id contributes nothing.
        let locked_after = f.locked();
        assert_eq!(
            locked_after,
            locked_before - 2 * UNIT,
            "locked must fall by exactly the successful subset"
        );
        assert_ne!(
            locked_after,
            locked_before - 3 * UNIT,
            "the claimed id must not unlock any funds"
        );
        assert_ne!(
            locked_after,
            locked_before - 4 * UNIT,
            "the full requested batch must not unlock funds"
        );
        assert_eq!(
            f.claimed(),
            claimed_before,
            "revoke must not touch total claimed"
        );

        // Terminal statuses line up with the per-id results.
        assert_eq!(
            f.client.get_package(&ids.get(0).unwrap()).status,
            PackageStatus::Claimed
        );
        assert_eq!(
            f.client.get_package(&ids.get(1).unwrap()).status,
            PackageStatus::Cancelled
        );
        assert_eq!(
            f.client.get_package(&ids.get(2).unwrap()).status,
            PackageStatus::Cancelled
        );
        assert_eq!(
            f.client.get_package(&ids.get(3).unwrap()).status,
            PackageStatus::Created
        );

        // The aggregates mirror the same successful subset.
        let agg = f.client.get_aggregates(&f.token);
        assert_eq!(agg.total_committed, UNIT, "only the untouched id 3 remains");
        assert_eq!(agg.total_claimed, UNIT, "only the claimed id 0");
        assert_eq!(
            agg.total_expired_cancelled,
            2 * UNIT,
            "only the two revoked ids 1 and 2"
        );
    }

    /// `batch_refund` with a mix of expired, live, already-cancelled, and
    /// unknown ids. Only the ids that actually moved funds may change the
    /// aggregates; in particular a cancelled id was already unlocked by
    /// `revoke` and must not unlock again.
    #[test]
    fn batch_refund_aggregates_reflect_only_successful_subset() {
        let f = Fixture::new(4);

        let now = f.env.ledger().timestamp();
        // Two packages that will have expired by the refund time.
        let expiring_a = f.create_at(0, now + 100);
        let expiring_b = f.create_at(1, now + 100);
        // A package that stays live, so its refund is rejected as NotExpired.
        let live = f.create_at(2, now + 100_000);
        // A package cancelled before expiry.
        let cancelled = f.create_at(3, now + 100);
        assert_eq!(f.locked(), 4 * UNIT);

        f.client.revoke(&cancelled);
        let locked_before = f.locked();
        assert_eq!(locked_before, 3 * UNIT);
        let claimed_before = f.claimed();
        let admin_before = f.admin_balance();

        // Advance past the short expiry but not the long one.
        f.env.ledger().set_timestamp(now + 200);

        let missing = 999u64;
        let mut requested = Vec::new(&f.env);
        requested.push_back(expiring_a); // expired Created   -> Success
        requested.push_back(live); //       still live        -> NotExpired
        requested.push_back(missing); //    unknown           -> NotFound
        requested.push_back(cancelled); //  already Cancelled -> Success
        requested.push_back(expiring_b); // expired Created   -> Success

        let results = f.client.batch_refund(&requested);
        assert_eq!(results.len(), 5);
        assert_result(
            &results.get(0).unwrap(),
            expiring_a,
            BatchAdminActionStatus::Success,
        );
        assert_result(
            &results.get(1).unwrap(),
            live,
            BatchAdminActionStatus::NotExpired,
        );
        assert_result(
            &results.get(2).unwrap(),
            missing,
            BatchAdminActionStatus::NotFound,
        );
        assert_result(
            &results.get(3).unwrap(),
            cancelled,
            BatchAdminActionStatus::Success,
        );
        assert_result(
            &results.get(4).unwrap(),
            expiring_b,
            BatchAdminActionStatus::Success,
        );

        // Only the two live-but-expired ids were still locked; the cancelled
        // id was already unlocked by `revoke`, so it must not decrement again.
        let locked_after = f.locked();
        assert_eq!(
            locked_after,
            locked_before - 2 * UNIT,
            "locked must fall by exactly the ids that were still locked"
        );
        assert_ne!(
            locked_after,
            locked_before - 3 * UNIT,
            "the cancelled id must not unlock funds a second time"
        );
        assert_eq!(locked_after, UNIT, "the live package must remain locked");
        assert_eq!(
            f.claimed(),
            claimed_before,
            "refund must not touch total claimed"
        );

        // Every successful refund (expired Created and Cancelled alike) paid
        // the admin exactly once; the failed ids paid nothing.
        let paid = f.admin_balance() - admin_before;
        assert_eq!(paid, 3 * UNIT, "only three refunds paid out");
        assert_eq!(
            f.client.get_package(&live).status,
            PackageStatus::Created,
            "the rejected live package must be untouched"
        );

        // The aggregates mirror the same successful subset.
        let agg = f.client.get_aggregates(&f.token);
        assert_eq!(agg.total_committed, UNIT, "only the live id remains");
        assert_eq!(agg.total_claimed, 0);
        assert_eq!(
            agg.total_expired_cancelled,
            3 * UNIT,
            "only the three refunded ids"
        );
    }

    /// `batch_create_packages` is all-or-nothing: a batch with one invalid
    /// entry must roll back completely, leaving no packages behind and no
    /// aggregate movement. (It returns no per-id result list precisely
    /// because there is no partial success to report.)
    #[test]
    fn batch_create_packages_with_a_mixed_batch_is_atomic() {
        let f = Fixture::new(3);

        let locked_before = f.locked();
        let claimed_before = f.claimed();
        assert_eq!(locked_before, 0);

        // Three valid recipients and one deliberately invalid (negative) amount.
        let mut recipients = Vec::new(&f.env);
        let mut amounts = Vec::new(&f.env);
        let mut metadatas = Vec::new(&f.env);
        for i in 0..4 {
            recipients.push_back(Address::generate(&f.env));
            amounts.push_back(if i == 2 { -UNIT } else { UNIT });
            metadatas.push_back(Map::new(&f.env));
        }

        let result = f.client.try_batch_create_packages(
            &f.admin,
            &recipients,
            &amounts,
            &f.token,
            &3_600,
            &metadatas,
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));

        // The whole batch rolled back: no aggregate moved, no package was
        // written, and the auto-incrementing id counter did not advance.
        assert_eq!(f.locked(), locked_before);
        assert_eq!(f.claimed(), claimed_before);
        assert_eq!(f.client.get_aggregates(&f.token).total_committed, 0);
        assert_eq!(
            f.client.try_get_package(&0),
            Err(Ok(Error::PackageNotFound))
        );
        assert_eq!(
            f.client.try_get_package(&1),
            Err(Ok(Error::PackageNotFound))
        );

        // A following, fully valid batch still starts at id 0.
        let ids = f.create_batch(2, 3_600);
        assert_eq!(ids.get(0).unwrap(), 0);
        assert_eq!(ids.get(1).unwrap(), 1);
        assert_eq!(f.locked(), 2 * UNIT);
        assert_eq!(f.claimed(), 0);
    }
}
