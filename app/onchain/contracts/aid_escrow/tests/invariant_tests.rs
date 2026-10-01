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
