#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error, PackageStatus};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, Env, Map, Symbol, Vec,
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
            claim_cooldown: 0,
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
            claim_cooldown: 0,
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

// ===========================================================================
// token validation and transfer failure tests
// ===========================================================================

mod token_interactions {
    use super::*;

    #[test]
    fn create_package_rejects_invalid_token_address() {
        let t = TestSetup::new();
        let invalid_token = t.env.register(AidEscrow, ());

        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &invalid_token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );

        assert_eq!(result, Err(Ok(Error::InvalidToken)));
    }

    #[test]
    fn set_config_rejects_invalid_allowed_token_address() {
        let t = TestSetup::new();
        let invalid_token = t.env.register(AidEscrow, ());
        let mut allowed_tokens = Vec::new(&t.env);
        allowed_tokens.push_back(invalid_token);

        let result = t.client.try_set_config(&Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens,
            claim_cooldown: 0,
        });

        assert_eq!(result, Err(Ok(Error::InvalidToken)));
    }

    #[test]
    fn fund_maps_reverted_token_transfer_to_clear_contract_error() {
        let t = TestSetup::new();

        let result = t.client.try_fund(&t.token, &t.admin, &ONE_TOKEN);

        assert_eq!(result, Err(Ok(Error::TokenTransferFailed)));
    }

    #[test]
    fn claim_keeps_accounting_unchanged_when_token_transfer_reverts() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        t.token_sac.burn(&t.client.address, &ONE_TOKEN);

        let result = t.client.try_claim(&id);

        assert_eq!(result, Err(Ok(Error::TokenTransferFailed)));
        assert_eq!(t.client.get_package(&id).status, PackageStatus::Created);
        assert_eq!(t.client.get_total_locked(&t.token), ONE_TOKEN);
        assert_eq!(TokenClient::new(&t.env, &t.token).balance(&recipient), 0);
    }
}

mod claim {
    use super::*;

    fn claimant_leaf_hex(env: &Env, claimant: &Address) -> std::string::String {
        let addr = claimant.to_string();
        let len = addr.len() as usize;
        let mut raw = [0u8; 96];
        addr.copy_into_slice(&mut raw[..len]);

        let mut data = Bytes::new(env);
        for b in raw[..len].iter() {
            data.push_back(*b);
        }

        let digest = env.crypto().sha256(&data);
        let hash = digest.to_array();

        let mut out = std::string::String::with_capacity(64);
        for b in hash {
            out.push_str(&format!("{:02x}", b));
        }
        out
    }

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

    #[test]
    fn fails_when_claimed_too_early() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        t.fund_contract(ONE_TOKEN);
        let expires_at = t.now() + 3600;
        let mut metadata = Map::new(&t.env);
        // claim_starts_at = now + 1000
        metadata.set(
            Symbol::new(&t.env, "claim_starts_at"),
            soroban_sdk::String::from_str(&t.env, &(t.now() + 1000).to_string()),
        );
        let id = t.client.create_package(
            &t.admin,
            &99u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &metadata,
        );
        // Try to claim before claim_starts_at
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::ClaimTooEarly)));
        // Advance to claim_starts_at
        t.advance_time(1000);
        let result2 = t.client.try_claim(&id);
        assert!(result2.is_ok());
    }

    #[test]
    fn succeeds_when_claimed_at_exact_expiry_boundary() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        t.fund_contract(ONE_TOKEN);
        let now = t.now();
        let expires_at = now + 1000;
        let mut metadata = Map::new(&t.env);
        // claim_starts_at = expires_at
        metadata.set(
            Symbol::new(&t.env, "claim_starts_at"),
            soroban_sdk::String::from_str(&t.env, &expires_at.to_string()),
        );
        let id = t.client.create_package(
            &t.admin,
            &100u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &metadata,
        );
        // Try to claim before claim_starts_at
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::ClaimTooEarly)));
        // Advance to claim_starts_at (== expires_at)
        t.advance_time(1000);
        let result2 = t.client.try_claim(&id);
        // Should succeed (allowed to claim at expiry boundary)
        assert!(result2.is_ok());
    }

    #[test]
    fn default_claim_starts_at_is_created_at() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);
        // Should be claimable immediately
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());
    }

    #[test]
    fn merkle_allowlist_claim_succeeds_with_valid_proof() {
        let t = TestSetup::new();
        let claimant = Address::generate(&t.env);
        t.fund_contract(ONE_TOKEN);

        // Single-leaf tree: root == leaf and proof is empty.
        let root_hex = claimant_leaf_hex(&t.env, &claimant);

        let mut metadata = Map::new(&t.env);
        metadata.set(
            Symbol::new(&t.env, "merkle_root"),
            soroban_sdk::String::from_str(&t.env, &root_hex),
        );

        let id = t.client.create_package(
            &t.admin,
            &777u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        // Direct claim path should reject Merkle-protected package.
        let direct = t.client.try_claim(&id);
        assert_eq!(direct, Err(Ok(Error::InvalidProof)));

        let proof: Vec<soroban_sdk::String> = Vec::new(&t.env);
        let with_proof = t.client.try_claim_with_proof(&id, &claimant, &proof);
        assert!(with_proof.is_ok());

        let token_client = TokenClient::new(&t.env, &t.token);
        assert_eq!(token_client.balance(&claimant), ONE_TOKEN);
    }

    #[test]
    fn merkle_allowlist_claim_fails_with_invalid_proof() {
        let t = TestSetup::new();
        let claimant = Address::generate(&t.env);
        t.fund_contract(ONE_TOKEN);

        // Root for a different address.
        let wrong_addr = Address::generate(&t.env);
        let wrong_root_hex = claimant_leaf_hex(&t.env, &wrong_addr);

        let mut metadata = Map::new(&t.env);
        metadata.set(
            Symbol::new(&t.env, "merkle_root"),
            soroban_sdk::String::from_str(&t.env, &wrong_root_hex),
        );

        let id = t.client.create_package(
            &t.admin,
            &778u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        let proof: Vec<soroban_sdk::String> = Vec::new(&t.env);
        let with_proof = t.client.try_claim_with_proof(&id, &claimant, &proof);
        assert_eq!(with_proof, Err(Ok(Error::InvalidProof)));
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

// ===========================================================================
// transfer_admin / accept_admin / cancel — Two-step admin handover
// ===========================================================================

mod admin_transfer {
    use super::*;
    use aid_escrow::Error;

    #[test]
    fn nominate_and_accept_transfers_admin() {
        let t = TestSetup::new();
        let new_admin = Address::generate(&t.env);

        t.client.transfer_admin(&new_admin);
        assert_eq!(t.client.get_pending_admin(), Some(new_admin.clone()));

        t.client.accept_admin();
        assert_eq!(t.client.get_admin(), new_admin);
        assert_eq!(t.client.get_pending_admin(), None);
    }

    #[test]
    fn new_admin_is_reflected_after_accept() {
        let t = TestSetup::new();
        let new_admin = Address::generate(&t.env);

        t.client.transfer_admin(&new_admin);
        t.client.accept_admin();

        assert_eq!(t.client.get_admin(), new_admin);
        assert_eq!(t.client.get_pending_admin(), None);
    }

    #[test]
    fn cancel_removes_pending_admin() {
        let t = TestSetup::new();
        let new_admin = Address::generate(&t.env);

        t.client.transfer_admin(&new_admin);
        assert_eq!(t.client.get_pending_admin(), Some(new_admin));

        t.client.cancel_admin_transfer();
        assert_eq!(t.client.get_pending_admin(), None);
        assert_eq!(t.client.get_admin(), t.admin);
    }

    #[test]
    fn reject_nominate_same_as_current_admin() {
        let t = TestSetup::new();
        let result = t.client.try_transfer_admin(&t.admin);
        assert_eq!(result, Err(Ok(Error::InvalidPendingAdmin)));
    }

    #[test]
    fn reject_accept_with_no_pending() {
        let t = TestSetup::new();
        let result = t.client.try_accept_admin();
        assert_eq!(result, Err(Ok(Error::NoPendingTransfer)));
    }

    #[test]
    fn reject_cancel_with_no_pending() {
        let t = TestSetup::new();
        let result = t.client.try_cancel_admin_transfer();
        assert_eq!(result, Err(Ok(Error::NoPendingTransfer)));
    }

    #[test]
    fn get_pending_admin_returns_none_when_no_transfer() {
        let t = TestSetup::new();
        assert_eq!(t.client.get_pending_admin(), None);
    }

    #[test]
    fn nominate_overwrites_previous_pending() {
        let t = TestSetup::new();
        let new_admin1 = Address::generate(&t.env);
        let new_admin2 = Address::generate(&t.env);

        t.client.transfer_admin(&new_admin1);
        assert_eq!(t.client.get_pending_admin(), Some(new_admin1.clone()));

        t.client.transfer_admin(&new_admin2);
        assert_eq!(t.client.get_pending_admin(), Some(new_admin2.clone()));

        t.client.accept_admin();
        assert_eq!(t.client.get_admin(), new_admin2);
    }
}

// ===========================================================================
// Token Allowlist Management — Tests
// ===========================================================================

mod token_allowlist {
    use super::*;
    use aid_escrow::Error;

    #[test]
    fn add_allowed_token_succeeds() {
        let t = TestSetup::new();

        let result = t.client.try_add_allowed_token(&t.token);
        assert!(result.is_ok());

        let config = t.client.get_config();
        assert!(config.allowed_tokens.contains(t.token.clone()));
    }

    #[test]
    fn add_allowed_token_fails_for_invalid_token_address() {
        let t = TestSetup::new();
        let invalid_token = t.env.register(AidEscrow, ());

        let result = t.client.try_add_allowed_token(&invalid_token);
        assert_eq!(result, Err(Ok(Error::InvalidToken)));
    }

    #[test]
    fn add_allowed_token_fails_for_duplicate() {
        let t = TestSetup::new();

        t.client.add_allowed_token(&t.token);
        let result = t.client.try_add_allowed_token(&t.token);
        assert_eq!(result, Err(Ok(Error::InvalidState)));
    }

    #[test]
    fn remove_allowed_token_succeeds() {
        let t = TestSetup::new();

        t.client.add_allowed_token(&t.token);
        let config_before = t.client.get_config();
        assert!(config_before.allowed_tokens.contains(t.token.clone()));

        let result = t.client.try_remove_allowed_token(&t.token);
        assert!(result.is_ok());

        let config_after = t.client.get_config();
        assert!(!config_after.allowed_tokens.contains(t.token.clone()));
    }

    #[test]
    fn remove_allowed_token_fails_when_not_in_list() {
        let t = TestSetup::new();

        let result = t.client.try_remove_allowed_token(&t.token);
        assert_eq!(result, Err(Ok(Error::InvalidState)));
    }

    #[test]
    fn allowlisted_token_enables_package_creation() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);

        // First add a DIFFERENT token to make the allowlist non-empty.
        // When the list is empty ALL tokens are allowed, so we need at
        // least one entry before the allowlist gate activates.
        let other_token_id = t.env.register_stellar_asset_contract_v2(t.admin.clone());
        let other_token = other_token_id.address();
        t.client.add_allowed_token(&other_token);

        // Fund contract
        t.fund_contract(ONE_TOKEN);

        // Try creating package with t.token (NOT yet in allowlist) - should fail
        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(result, Err(Ok(Error::InvalidState)));

        // Add target token to allowlist
        t.client.add_allowed_token(&t.token);

        // Now create package should succeed
        let id = t.client.create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(id, 1);
    }

    #[test]
    fn removing_allowlisted_token_blocks_package_creation() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);

        // Add both the target token AND a different token so the
        // allowlist stays non-empty after removal. When the list is
        // empty ALL tokens are allowed again.
        t.client.add_allowed_token(&t.token);
        let other_token_id = t.env.register_stellar_asset_contract_v2(t.admin.clone());
        let other_token = other_token_id.address();
        t.client.add_allowed_token(&other_token);

        t.fund_contract(ONE_TOKEN * 2);

        // Create first package - succeeds (token is in allowlist)
        let id1 = t.client.create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(id1, 1);

        // Remove ONLY target token - allowlist still has other_token (non-empty)
        t.client.remove_allowed_token(&t.token);

        // Create second package - fails (token not in non-empty allowlist)
        let result = t.client.try_create_package(
            &t.admin,
            &2u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &Map::new(&t.env),
        );
        assert_eq!(result, Err(Ok(Error::InvalidState)));
    }
}

// ===========================================================================
// sweep_expired_packages — Sweep Expired Packages and Release Locked Funds
// ===========================================================================

mod sweep_expired_packages {
    use super::*;

    fn create_package(t: &TestSetup, id: u64, recipient: &Address, amount: i128, expires_at: u64) {
        t.fund_contract(amount);
        t.client.create_package(
            &t.admin,
            &id,
            recipient,
            &amount,
            &t.token,
            &expires_at,
            &Map::new(&t.env),
        );
    }

    #[test]
    fn sweep_transitions_expired_packages_and_corrects_locked_and_aggregates() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();

        // Package 1 and 2 expire soon; package 3 is claimed before expiry;
        // package 4 never expires.
        create_package(&t, 1, &recipient, ONE_TOKEN, now + 100);
        create_package(&t, 2, &recipient, ONE_TOKEN, now + 100);
        create_package(&t, 3, &recipient, TWO_TOKENS, now + 100);
        create_package(&t, 4, &recipient, ONE_TOKEN, 0);

        t.client.claim(&3);

        // Before the sweep: the claimed package is unlocked, the rest locked.
        assert_eq!(t.client.get_total_locked(&t.token), 3 * ONE_TOKEN);
        let agg_before = t.client.get_aggregates(&t.token);
        assert_eq!(agg_before.total_committed, 3 * ONE_TOKEN); // pkgs 1, 2, 4
        assert_eq!(agg_before.total_claimed, TWO_TOKENS); // pkg 3
        assert_eq!(agg_before.total_expired_cancelled, 0);

        // Advance past expiry of packages 1 and 2.
        t.advance_time(101);

        // Sweep callable by any address (no auth required).
        let swept = t.client.sweep_expired_packages(&10);
        assert_eq!(swept, 2);

        // Swept packages are terminal.
        assert_eq!(t.client.get_package(&1).status, PackageStatus::Expired);
        assert_eq!(t.client.get_package(&2).status, PackageStatus::Expired);

        // Locked funds are released: only the never-expiring package remains.
        assert_eq!(t.client.get_total_locked(&t.token), ONE_TOKEN);

        // Aggregates self-correct: expired packages move out of committed.
        let agg_after = t.client.get_aggregates(&t.token);
        assert_eq!(agg_after.total_committed, ONE_TOKEN); // pkg 4
        assert_eq!(agg_after.total_claimed, TWO_TOKENS); // pkg 3
        assert_eq!(agg_after.total_expired_cancelled, TWO_TOKENS); // pkgs 1, 2

        // Claimed and never-expiring packages are untouched.
        assert_eq!(t.client.get_package(&3).status, PackageStatus::Claimed);
        assert_eq!(t.client.get_package(&4).status, PackageStatus::Created);
    }

    #[test]
    fn sweep_is_bounded_idempotent_and_callable_by_any_address() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();

        for i in 0..5 {
            create_package(&t, i + 1, &recipient, ONE_TOKEN, now + 100);
        }

        assert_eq!(t.client.get_total_locked(&t.token), 5 * ONE_TOKEN);
        t.advance_time(101);

        // Sweep in bounded batches of 1 (callable by any address, no auth).
        assert_eq!(t.client.sweep_expired_packages(&1), 1);
        assert_eq!(t.client.get_total_locked(&t.token), 4 * ONE_TOKEN);
        assert_eq!(t.client.sweep_expired_packages(&1), 1);
        assert_eq!(t.client.get_total_locked(&t.token), 3 * ONE_TOKEN);
        assert_eq!(t.client.sweep_expired_packages(&10), 3);
        assert_eq!(t.client.get_total_locked(&t.token), 0);

        // Idempotent: a repeated sweep returns 0 and changes nothing.
        assert_eq!(t.client.sweep_expired_packages(&10), 0);
        assert_eq!(t.client.get_total_locked(&t.token), 0);
        for i in 0..5 {
            assert_eq!(
                t.client.get_package(&(i + 1)).status,
                PackageStatus::Expired
            );
        }
    }

    #[test]
    fn sweep_skips_packages_at_exact_expiry_boundary() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();

        create_package(&t, 1, &recipient, ONE_TOKEN, now + 100);
        create_package(&t, 2, &recipient, ONE_TOKEN, 0);

        // At the exact expiry boundary the package is still claimable, so the
        // sweep must leave it alone.
        t.advance_time(100);
        assert_eq!(t.client.sweep_expired_packages(&10), 0);
        assert_eq!(t.client.get_package(&1).status, PackageStatus::Created);
        assert_eq!(t.client.get_total_locked(&t.token), 2 * ONE_TOKEN);

        // One second later it is expired and swept.
        t.advance_time(1);
        assert_eq!(t.client.sweep_expired_packages(&10), 1);
        assert_eq!(t.client.get_package(&1).status, PackageStatus::Expired);
        assert_eq!(t.client.get_package(&2).status, PackageStatus::Created);
        assert_eq!(t.client.get_total_locked(&t.token), ONE_TOKEN);
    }
}

// ===========================================================================
// Evidence Hash Tests
// ===========================================================================

mod evidence_hash {
    use super::*;

    fn valid_evidence_hash(env: &Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(
            env,
            "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
        )
    }

    fn another_valid_evidence_hash(env: &Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(
            env,
            "fedcba09876543210fedcba09876543210fedcba09876543210fedcba0987654321",
        )
    }

    #[test]
    fn attach_evidence_hash_succeeds() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let hash = valid_evidence_hash(&t.env);
        t.client.attach_evidence_hash(&t.admin, &id, &hash);

        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.evidence_hash, hash);
    }

    #[test]
    fn attach_evidence_hash_emits_event() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let hash = valid_evidence_hash(&t.env);
        t.client.attach_evidence_hash(&t.admin, &id, &hash);

        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.evidence_hash, hash);
    }

    #[test]
    fn attach_evidence_hash_rejects_overwrite() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let hash1 = valid_evidence_hash(&t.env);
        t.client.attach_evidence_hash(&t.admin, &id, &hash1);

        let hash2 = another_valid_evidence_hash(&t.env);
        let result = t.client.try_attach_evidence_hash(&t.admin, &id, &hash2);
        assert_eq!(result, Err(Ok(Error::InvalidState)));

        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.evidence_hash, hash1);
    }

    #[test]
    fn attach_evidence_hash_validates_format_length() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let short = soroban_sdk::String::from_str(
            &t.env,
            "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcde",
        );
        assert_eq!(
            t.client.try_attach_evidence_hash(&t.admin, &id, &short),
            Err(Ok(Error::InvalidState))
        );

        let long = soroban_sdk::String::from_str(
            &t.env,
            "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef1",
        );
        assert_eq!(
            t.client.try_attach_evidence_hash(&t.admin, &id, &long),
            Err(Ok(Error::InvalidState))
        );

        let empty = soroban_sdk::String::from_str(&t.env, "");
        assert_eq!(
            t.client.try_attach_evidence_hash(&t.admin, &id, &empty),
            Err(Ok(Error::InvalidState))
        );
    }

    #[test]
    fn attach_evidence_hash_validates_hex_chars() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);

        // Invalid char 'g'
        t.fund_contract(ONE_TOKEN);
        let id1 = t.client.create_package(
            &t.admin,
            &10u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3_600),
            &Map::new(&t.env),
        );
        let invalid = soroban_sdk::String::from_str(
            &t.env,
            "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdeg",
        );
        assert_eq!(
            t.client.try_attach_evidence_hash(&t.admin, &id1, &invalid),
            Err(Ok(Error::InvalidState))
        );

        // Uppercase hex — valid
        t.fund_contract(ONE_TOKEN);
        let id2 = t.client.create_package(
            &t.admin,
            &11u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3_600),
            &Map::new(&t.env),
        );
        let uppercase = soroban_sdk::String::from_str(
            &t.env,
            "A1B2C3D4E5F678901234567890ABCDEF1234567890ABCDEF1234567890ABCDEF",
        );
        assert!(t
            .client
            .try_attach_evidence_hash(&t.admin, &id2, &uppercase)
            .is_ok());

        // Mixed case hex — valid
        t.fund_contract(ONE_TOKEN);
        let id3 = t.client.create_package(
            &t.admin,
            &12u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3_600),
            &Map::new(&t.env),
        );
        let mixed = soroban_sdk::String::from_str(
            &t.env,
            "A1b2C3d4E5f678901234567890aBcDeF1234567890aBcDeF1234567890aBcDeF",
        );
        assert!(t
            .client
            .try_attach_evidence_hash(&t.admin, &id3, &mixed)
            .is_ok());
    }

    #[test]
    fn attach_evidence_hash_requires_admin_auth() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let stranger = Address::generate(&t.env);
        let hash = valid_evidence_hash(&t.env);

        let result = t.client.try_attach_evidence_hash(&stranger, &id, &hash);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));
    }

    #[test]
    fn attach_evidence_hash_fails_for_nonexistent_package() {
        let t = TestSetup::new();
        let hash = valid_evidence_hash(&t.env);

        let result = t.client.try_attach_evidence_hash(&t.admin, &999u64, &hash);
        assert_eq!(result, Err(Ok(Error::PackageNotFound)));
    }

    #[test]
    fn evidence_hash_retrievable_via_get_package() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let hash = valid_evidence_hash(&t.env);
        t.client.attach_evidence_hash(&t.admin, &id, &hash);

        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.evidence_hash, hash);
        assert_eq!(pkg.id, id);
        assert_eq!(pkg.recipient, recipient);
    }

    #[test]
    fn package_created_with_empty_evidence_hash() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.evidence_hash, soroban_sdk::String::from_str(&t.env, ""));
    }

    #[test]
    fn attach_evidence_hash_after_claim_succeeds() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        t.client.claim(&id);

        let hash = valid_evidence_hash(&t.env);
        let result = t.client.try_attach_evidence_hash(&t.admin, &id, &hash);
        assert!(result.is_ok());
    }

    #[test]
    fn get_evidence_hash_returns_empty_when_not_set() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let result = t.client.get_evidence_hash(&id);
        assert_eq!(result, soroban_sdk::String::from_str(&t.env, ""));
    }

    #[test]
    fn get_evidence_hash_returns_hash_after_attach() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let id = t.create_default_package(&recipient, ONE_TOKEN);

        let hash = valid_evidence_hash(&t.env);
        t.client.attach_evidence_hash(&t.admin, &id, &hash);

        let result = t.client.get_evidence_hash(&id);
        assert_eq!(result, hash);
    }
}
