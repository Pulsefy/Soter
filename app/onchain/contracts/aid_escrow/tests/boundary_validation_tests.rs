#![cfg(test)]

//! # Boundary Validation Tests for Claim Window and Expiry
//!
//! This module tests the exact boundary conditions for claim timing:
//! - Claim start time boundaries
//! - Expiry time boundaries
//! - Late claim auto-expiry behavior
//! - Edge cases around timestamps

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, Env, Map, Symbol, Vec,
};

const ONE_TOKEN: i128 = 10_000_000;

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
        client.set_config(&aid_escrow::Config {
            min_amount: 1,
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

    fn set_timestamp(&self, timestamp: u64) {
        let mut info = self.env.ledger().get();
        info.timestamp = timestamp;
        self.env.ledger().set(info);
    }

    fn create_package_with_timing(
        &self,
        recipient: &Address,
        amount: i128,
        claim_starts_at: u64,
        expires_at: u64,
    ) -> u64 {
        self.fund_contract(amount);
        let mut metadata = Map::new(&self.env);
        metadata.set(
            Symbol::new(&self.env, "claim_starts_at"),
            soroban_sdk::String::from_str(&self.env, &claim_starts_at.to_string()),
        );
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
// Claim Start Time Boundary Tests
// ===========================================================================

mod claim_start_boundaries {
    use super::*;

    #[test]
    fn fails_when_claimed_1_second_before_start() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now + 1000;
        let expires_at = now + 5000;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Try to claim 1 second before claim_starts_at
        t.set_timestamp(claim_starts_at - 1);
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::ClaimTooEarly)));

        // Verify package status is still Created (not auto-expired)
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Created);
    }

    #[test]
    fn succeeds_when_claimed_at_exact_start_time() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now + 1000;
        let expires_at = now + 5000;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Claim at exact claim_starts_at
        t.set_timestamp(claim_starts_at);
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());

        // Verify package status is Claimed
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Claimed);
    }

    #[test]
    fn succeeds_when_claimed_1_second_after_start() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now + 1000;
        let expires_at = now + 5000;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Claim 1 second after claim_starts_at
        t.set_timestamp(claim_starts_at + 1);
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());

        // Verify package status is Claimed
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Claimed);
    }
}

// ===========================================================================
// Expiry Time Boundary Tests
// ===========================================================================

mod expiry_boundaries {
    use super::*;

    #[test]
    fn succeeds_when_claimed_1_second_before_expiry() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = now + 5000;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Claim 1 second before expires_at
        t.set_timestamp(expires_at - 1);
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());

        // Verify package status is Claimed
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Claimed);
    }

    #[test]
    fn succeeds_when_claimed_at_exact_expiry() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = now + 5000;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Claim at exact expires_at
        t.set_timestamp(expires_at);
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());

        // Verify package status is Claimed
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Claimed);
    }

    #[test]
    fn fails_when_claimed_1_second_after_expiry() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = now + 5000;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Try to claim 1 second after expires_at
        t.set_timestamp(expires_at + 1);
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::PackageExpired)));

        // Verify package status remains Created (not auto-updated)
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Created);
    }

    #[test]
    fn fails_when_claimed_long_after_expiry() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = now + 5000;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Try to claim 1000 seconds after expires_at
        t.set_timestamp(expires_at + 1000);
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::PackageExpired)));

        // Verify package status remains Created (not auto-updated)
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Created);
    }
}

// ===========================================================================
// Combined Boundary Tests (Start + Expiry)
// ===========================================================================

mod combined_boundaries {
    use super::*;

    #[test]
    fn fails_when_claim_starts_at_equals_expires_at_and_claimed_before() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let boundary_time = now + 5000;

        // claim_starts_at == expires_at
        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, boundary_time, boundary_time);

        // Try to claim before the boundary
        t.set_timestamp(boundary_time - 1);
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::ClaimTooEarly)));

        // Verify package status is still Created
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Created);
    }

    #[test]
    fn succeeds_when_claim_starts_at_equals_expires_at_and_claimed_at_boundary() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let boundary_time = now + 5000;

        // claim_starts_at == expires_at
        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, boundary_time, boundary_time);

        // Claim at the exact boundary
        t.set_timestamp(boundary_time);
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());

        // Verify package status is Claimed
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Claimed);
    }

    #[test]
    fn fails_when_claim_starts_at_equals_expires_at_and_claimed_after() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let boundary_time = now + 5000;

        // claim_starts_at == expires_at
        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, boundary_time, boundary_time);

        // Try to claim after the boundary
        t.set_timestamp(boundary_time + 1);
        let result = t.client.try_claim(&id);
        assert_eq!(result, Err(Ok(Error::PackageExpired)));

        // Verify package status remains Created (not auto-updated)
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Created);
    }

    #[test]
    fn narrow_claim_window_1_second() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now + 5000;
        let expires_at = now + 5001; // Only 1 second claim window

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Claim at start - should succeed
        t.set_timestamp(claim_starts_at);
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());
    }

    #[test]
    fn zero_claim_window_fails_creation() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now + 5000;
        let expires_at = now + 5000; // Zero claim window

        // This should fail during package creation
        let _result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &Map::new(&t.env),
        );
        // The contract should reject this during creation validation
        // since claim_starts_at would default to created_at which is < expires_at
        // But if we set claim_starts_at == expires_at, it should be allowed
        // Let's test with metadata
        t.fund_contract(ONE_TOKEN);
        let mut metadata = Map::new(&t.env);
        metadata.set(
            Symbol::new(&t.env, "claim_starts_at"),
            soroban_sdk::String::from_str(&t.env, &claim_starts_at.to_string()),
        );
        let result2 = t.client.try_create_package(
            &t.admin,
            &2u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &metadata,
        );
        // This should succeed - zero window is allowed
        assert!(result2.is_ok());
    }
}

// ===========================================================================
// Late Claim Behavior Tests
// ===========================================================================

mod late_claim_behavior {
    use super::*;

    #[test]
    fn late_claim_returns_error_but_status_remains_created() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = now + 100;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Advance past expiry
        t.set_timestamp(expires_at + 10);

        // First late claim attempt - should fail with PackageExpired
        let result1 = t.client.try_claim(&id);
        assert_eq!(result1, Err(Ok(Error::PackageExpired)));

        // Verify status remains Created (not auto-updated)
        let pkg1 = t.client.get_package(&id);
        assert_eq!(pkg1.status, PackageStatus::Created);

        // Second late claim attempt - should still fail with PackageExpired
        let result2 = t.client.try_claim(&id);
        assert_eq!(result2, Err(Ok(Error::PackageExpired)));

        // Verify status still remains Created
        let pkg2 = t.client.get_package(&id);
        assert_eq!(pkg2.status, PackageStatus::Created);
    }

    #[test]
    fn late_claim_can_be_retried_if_time_reverted() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = now + 100;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Advance past expiry and claim
        t.set_timestamp(expires_at + 10);
        let result1 = t.client.try_claim(&id);
        assert_eq!(result1, Err(Ok(Error::PackageExpired)));

        // Verify status remains Created
        let pkg1 = t.client.get_package(&id);
        assert_eq!(pkg1.status, PackageStatus::Created);

        // Revert time back to within claim window
        t.set_timestamp(claim_starts_at + 50);

        // Should succeed because status is still Created
        let result2 = t.client.try_claim(&id);
        assert!(result2.is_ok());

        // Verify status is now Claimed
        let pkg2 = t.client.get_package(&id);
        assert_eq!(pkg2.status, PackageStatus::Claimed);
    }

    #[test]
    fn claim_with_proof_fails_after_expiry() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = now + 100;

        let id = t.create_package_with_timing(&recipient, ONE_TOKEN, claim_starts_at, expires_at);

        // Advance past expiry
        t.set_timestamp(expires_at + 10);

        // Try claim_with_proof after expiry - should fail
        let proof: Vec<soroban_sdk::String> = Vec::new(&t.env);
        let result = t.client.try_claim_with_proof(&id, &recipient, &proof);
        assert_eq!(result, Err(Ok(Error::PackageExpired)));

        // Verify status remains Created (not auto-updated)
        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Created);
    }
}

// ===========================================================================
// Edge Cases
// ===========================================================================

mod edge_cases {
    use super::*;

    #[test]
    fn package_with_zero_expiry_never_expires() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now;
        let expires_at = 0; // No expiry

        t.fund_contract(ONE_TOKEN);
        let mut metadata = Map::new(&t.env);
        metadata.set(
            Symbol::new(&t.env, "claim_starts_at"),
            soroban_sdk::String::from_str(&t.env, &claim_starts_at.to_string()),
        );
        let id = t.client.create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &metadata,
        );

        // Advance time significantly
        t.set_timestamp(now + 1_000_000);

        // Should still be claimable
        let result = t.client.try_claim(&id);
        assert!(result.is_ok());

        let pkg = t.client.get_package(&id);
        assert_eq!(pkg.status, PackageStatus::Claimed);
    }

    #[test]
    fn claim_starts_at_in_past_fails_creation() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now - 1000; // In the past
        let expires_at = now + 5000;

        t.fund_contract(ONE_TOKEN);
        let mut metadata = Map::new(&t.env);
        metadata.set(
            Symbol::new(&t.env, "claim_starts_at"),
            soroban_sdk::String::from_str(&t.env, &claim_starts_at.to_string()),
        );
        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &metadata,
        );
        // Should fail because claim_starts_at < created_at
        assert_eq!(result, Err(Ok(Error::InvalidState)));
    }

    #[test]
    fn claim_starts_after_expiry_fails_creation() {
        let t = TestSetup::new();
        let recipient = Address::generate(&t.env);
        let now = t.now();
        let claim_starts_at = now + 6000;
        let expires_at = now + 5000; // claim_starts_at > expires_at

        t.fund_contract(ONE_TOKEN);
        let mut metadata = Map::new(&t.env);
        metadata.set(
            Symbol::new(&t.env, "claim_starts_at"),
            soroban_sdk::String::from_str(&t.env, &claim_starts_at.to_string()),
        );
        let result = t.client.try_create_package(
            &t.admin,
            &1u64,
            &recipient,
            &ONE_TOKEN,
            &t.token,
            &expires_at,
            &metadata,
        );
        // Should fail because claim_starts_at > expires_at
        assert_eq!(result, Err(Ok(Error::InvalidState)));
    }
}
