#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error, PackageStatus};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Map, Vec,
};

// ---------------------------------------------------------------------------
// Constants for 7-decimal tokens (Standard Stellar Asset)
// ---------------------------------------------------------------------------
const ONE_TOKEN: i128 = 10_000_000;
const TWO_TOKENS: i128 = 20_000_000;
const HALF_TOKEN: i128 = 5_000_000; // Note: This will fail precision check

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn default_ledger_info() -> LedgerInfo {
    LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 23,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3_110_400,
    }
}

struct TestSetup {
    env: Env,
    client: AidEscrowClient<'static>,
    admin: Address,
    token: Address,
    token_sac: StellarAssetClient<'static>,
}

impl TestSetup {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().set(default_ledger_info());
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let token_sac = StellarAssetClient::new(&env, &token);

        client.init(&admin);
        client.set_config(&Config {
            min_amount: 1, // Minimum 1 stroop
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
        });

        Self {
            env,
            client,
            admin,
            token,
            token_sac,
        }
    }

    fn fund_contract(&self, amount: i128) {
        self.token_sac.mint(&self.client.address, &amount);
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    fn advance_time(&self, seconds: u64) {
        let mut info = self.env.ledger().get();
        info.timestamp += seconds;
        self.env.ledger().set(info);
    }

    fn create_default_package(&self, recipient: &Address, amount: i128) -> u64 {
        self.fund_contract(amount);
        let expires_at = self.now() + 3_600;
        let metadata = Map::new(&self.env);
        self.client.create_package(
            &self.admin,
            &1u64,
            recipient,
            &amount,
            &self.token,
            &expires_at,
            &metadata,
        )
    }
}

// ===========================================================================
// create_package — Tests
// ===========================================================================

mod create_package {
    use super::*;

    #[test]
    fn succeeds_with_valid_inputs() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Created);
        assert_eq!(pkg.amount, ONE_TOKEN);
    }

    #[test]
    fn succeeds_with_metadata() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        t.fund_contract(ONE_TOKEN);
        let expires_at = t.now() + 3_600;
        let mut metadata = Map::new(&t.env);
        metadata.set(
            symbol_short!("tag"),
            soroban_sdk::String::from_str(&t.env, "aid-01"),
        );

        let id = t.client.create_package(
            &t.admin,
            &42u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &metadata,
        );
        let pkg = t.client.get_package(&id);
        assert_eq!(
            pkg.metadata.get(symbol_short!("tag")).unwrap(),
            soroban_sdk::String::from_str(&t.env, "aid-01")
        );
    }

    #[test]
    fn fails_when_amount_below_min_amount() {
        let t = TestSetup::new();
        t.client.set_config(&Config {
            min_amount: TWO_TOKENS, // Min 2.0 tokens
            max_expires_in: 0,
            allowed_tokens: Vec::new(&t.env),
        });
        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn fails_when_package_id_already_exists() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        t.create_default_package(&recipient, ONE_TOKEN);
        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(result, Err(Ok(Error::PackageIdExists)));
    }

    #[test]
    fn fails_when_contract_has_insufficient_balance() {
        let t = TestSetup::new();
        t.fund_contract(HALF_TOKEN); // Fund 0.5, but precision check requires 1.0 minimum or multiples
        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
    }
}

// ===========================================================================
// claim — Tests
// ===========================================================================

mod claim {
    use super::*;

    #[test]
    fn succeeds_when_recipient_claims_within_window() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, TWO_TOKENS);

        t.client.claim(&id);
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Claimed);

        let token_client = TokenClient::new(&t.env, &t.token);
        assert_eq!(token_client.balance(&recipient), TWO_TOKENS);
    }

    #[test]
    fn fails_when_package_is_expired() {
        let t = TestSetup::new();
        let id = t.create_default_package(&Address::generate(&t.env), ONE_TOKEN);
        t.advance_time(3601);
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::PackageExpired)));
    }
}

// ===========================================================================
// Edge Cases
// ===========================================================================

mod edge_cases {
    use super::*;

    #[test]
    fn refund_succeeds_on_expired_package() {
        let t = TestSetup::new();
        let id = t.create_default_package(&Address::generate(&t.env), ONE_TOKEN);
        t.advance_time(3601);
        t.client.refund(&id);
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Refunded);
    }

    #[test]
    fn locked_funds_released_after_claim_allows_new_package() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);

        t.fund_contract(ONE_TOKEN);
        t.client.create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );

        // Contract balance is now fully locked. 2nd package should fail.
        let r2 = t.client.try_create_package(
            &t.admin,
            &2u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(r2, Err(Ok(Error::InsufficientFunds)));

        t.client.claim(&1u64); // Release lock

        t.fund_contract(ONE_TOKEN); // Refill
        let r3 = t.client.try_create_package(
            &t.admin,
            &3u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert!(r3.is_ok());
    }
}

mod token_decimal_normalization {
    use super::*;

    #[test]
    fn fails_with_precision_breaking_amount() {
        let t = TestSetup::new();
        t.fund_contract(TWO_TOKENS);

        // 10,000,001 is not a multiple of 10,000,000 (10^7)
        let precision_breaking = ONE_TOKEN + 1;

        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &Address::generate(&t.env),
            &precision_breaking,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn succeeds_with_whole_token_amounts() {
        let t = TestSetup::new();
        t.fund_contract(TWO_TOKENS);
        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert!(result.is_ok());
    }
}
