// #![cfg(all(test, not(target_arch = "wasm32")))]

// use soroban_sdk::{
//     Address, Env, Vec,
//     testutils::{Address as _, Ledger, LedgerInfo},
//     token::{Client as TokenClient, StellarAssetClient},
// };

// use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error, Package, PackageStatus};

// // ---------------------------------------------------------------------------
// // Test helpers
// // ---------------------------------------------------------------------------

// /// Bare minimum ledger state every test starts from.
// fn default_ledger_info() -> LedgerInfo {
//     LedgerInfo {
//         timestamp: 1_000_000,
//         protocol_version: 22,
//         sequence_number: 100,
//         network_id: Default::default(),
//         base_reserve: 10,
//         min_temp_entry_ttl: 10,
//         min_persistent_entry_ttl: 10,
//         max_entry_ttl: 3_110_400,
//     }
// }

// struct TestSetup {
//     env: Env,
//     client: AidEscrowClient<'static>,
//     admin: Address,
//     token: Address,
//     /// SAC client used to mint tokens to the contract or other addresses.
//     token_sac: StellarAssetClient<'static>,
// }

// impl TestSetup {
//     /// Creates a fresh environment, registers the contract, creates a test
//     /// token, and initialises the escrow contract with a default Config.
//     fn new() -> Self {
//         let env = Env::default();
//         env.ledger().set(default_ledger_info());
//         env.mock_all_auths();

//         let admin = Address::generate(&env);
//         let contract_id = env.register(AidEscrow, ());
//         let client = AidEscrowClient::new(&env, &contract_id);

//         // Create a Stellar Asset Contract token so we can mint freely.
//         let token_id = env.register_stellar_asset_contract_v2(admin.clone());
//         let token = token_id.address();
//         let token_sac = StellarAssetClient::new(&env, &token);

//         // Init the escrow with an open config (no token restrictions, no max expiry).
//         client.init(&admin).unwrap();
//         client
//             .set_config(&Config {
//                 min_amount: 1,
//                 max_expires_in: 0,
//                 allowed_tokens: Vec::new(&env),
//             })
//             .unwrap();

//         Self {
//             env,
//             client,
//             admin,
//             token,
//             token_sac,
//         }
//     }

//     /// Mint `amount` tokens directly to the escrow contract so packages can
//     /// be created against a funded pool.
//     fn fund_contract(&self, amount: i128) {
//         self.token_sac.mint(&self.client.address, &amount);
//     }

//     /// Returns the current ledger timestamp.
//     fn now(&self) -> u64 {
//         self.env.ledger().timestamp()
//     }

//     /// Advance the ledger clock by `seconds`.
//     fn advance_time(&self, seconds: u64) {
//         let mut info = self.env.ledger().get();
//         info.timestamp += seconds;
//         self.env.ledger().set(info);
//     }

//     /// Create a package with sensible defaults; returns the package id.
//     fn create_default_package(&self, recipient: &Address, amount: i128) -> u64 {
//         self.fund_contract(amount);
//         let expires_at = self.now() + 3_600; // 1 hour from now
//         self.client
//             .create_package(&1u64, recipient, &amount, &self.token, &expires_at)
//             .unwrap()
//     }
// }

// // ===========================================================================
// // create_package — error paths
// // ===========================================================================

// mod create_package {
//     use super::*;

//     // -----------------------------------------------------------------------
//     // Invalid amount
//     // -----------------------------------------------------------------------

//     /// amount = 0 must return InvalidAmount.
//     #[test]
//     fn fails_when_amount_is_zero() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let expires_at = t.now() + 3_600;

//         let result = t
//             .client
//             .create_package(&1u64, &recipient, &0i128, &t.token, &expires_at);

//         assert_eq!(result, Err(Ok(Error::InvalidAmount)));
//     }

//     /// Negative amounts must also be rejected.
//     #[test]
//     fn fails_when_amount_is_negative() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let expires_at = t.now() + 3_600;

//         let result = t
//             .client
//             .create_package(&2u64, &recipient, &(-10i128), &t.token, &expires_at);

//         assert_eq!(result, Err(Ok(Error::InvalidAmount)));
//     }

//     /// Amount below the configured min_amount must return InvalidAmount.
//     #[test]
//     fn fails_when_amount_below_min_amount() {
//         let t = TestSetup::new();

//         // Raise the minimum to 100.
//         t.client
//             .set_config(&Config {
//                 min_amount: 100,
//                 max_expires_in: 0,
//                 allowed_tokens: Vec::new(&t.env),
//             })
//             .unwrap();

//         let recipient = Address::generate(&t.env);
//         let expires_at = t.now() + 3_600;
//         t.fund_contract(50);

//         let result = t
//             .client
//             .create_package(&3u64, &recipient, &50i128, &t.token, &expires_at);

//         assert_eq!(result, Err(Ok(Error::InvalidAmount)));
//     }

//     // -----------------------------------------------------------------------
//     // Missing admin (NotInitialized)
//     // -----------------------------------------------------------------------

//     /// A fresh contract with no init call must return NotInitialized.
//     #[test]
//     fn fails_when_contract_not_initialized() {
//         let env = Env::default();
//         env.ledger().set(default_ledger_info());
//         env.mock_all_auths();

//         // Register the contract but do NOT call init().
//         let contract_id = env.register(AidEscrow, ());
//         let client = AidEscrowClient::new(&env, &contract_id);

//         let token = Address::generate(&env);
//         let recipient = Address::generate(&env);
//         let expires_at = env.ledger().timestamp() + 3_600;

//         let result = client.create_package(&1u64, &recipient, &100i128, &token, &expires_at);

//         assert_eq!(result, Err(Ok(Error::NotInitialized)));
//     }

//     // -----------------------------------------------------------------------
//     // Admin auth
//     // -----------------------------------------------------------------------

//     /// Calling create_package without admin auth must be rejected.
//     ///
//     /// We deliberately do NOT call env.mock_all_auths() here, and we do not
//     /// mock the specific auth either — so the SDK will deny the call.
//     #[test]
//     #[should_panic] // Soroban SDK panics on auth failure in tests
//     fn fails_when_caller_is_not_admin() {
//         let env = Env::default();
//         env.ledger().set(default_ledger_info());
//         // No mock_all_auths — auth will not be satisfied.

//         let admin = Address::generate(&env);
//         let contract_id = env.register(AidEscrow, ());
//         let client = AidEscrowClient::new(&env, &contract_id);

//         // Init with mocked auth so the contract state is valid.
//         env.mock_all_auths();
//         client.init(&admin).unwrap();
//         env.set_auths(&[]); // Clear mocked auths — subsequent calls require real auth.

//         let token = Address::generate(&env);
//         let recipient = Address::generate(&env);
//         let expires_at = env.ledger().timestamp() + 3_600;

//         // This must panic because admin.require_auth() cannot be satisfied.
//         let _ = client.create_package(&1u64, &recipient, &100i128, &token, &expires_at);
//     }

//     // -----------------------------------------------------------------------
//     // Duplicate package ID
//     // -----------------------------------------------------------------------

//     #[test]
//     fn fails_when_package_id_already_exists() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let expires_at = t.now() + 3_600;

//         t.fund_contract(200);

//         // First creation succeeds.
//         t.client
//             .create_package(&42u64, &recipient, &100i128, &t.token, &expires_at)
//             .unwrap();

//         // Second creation with the same ID must fail.
//         let result = t
//             .client
//             .create_package(&42u64, &recipient, &50i128, &t.token, &expires_at);

//         assert_eq!(result, Err(Ok(Error::PackageIdExists)));
//     }

//     // -----------------------------------------------------------------------
//     // Insufficient funds
//     // -----------------------------------------------------------------------

//     #[test]
//     fn fails_when_contract_has_insufficient_balance() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let expires_at = t.now() + 3_600;

//         // Fund only 50 but ask for 100.
//         t.fund_contract(50);

//         let result = t
//             .client
//             .create_package(&1u64, &recipient, &100i128, &t.token, &expires_at);

//         assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
//     }

//     // -----------------------------------------------------------------------
//     // Token allowlist
//     // -----------------------------------------------------------------------

//     #[test]
//     fn fails_when_token_not_in_allowlist() {
//         let t = TestSetup::new();

//         let allowed_token = Address::generate(&t.env);
//         let disallowed_token = Address::generate(&t.env);

//         let mut allowed = Vec::new(&t.env);
//         allowed.push_back(allowed_token);

//         t.client
//             .set_config(&Config {
//                 min_amount: 1,
//                 max_expires_in: 0,
//                 allowed_tokens: allowed,
//             })
//             .unwrap();

//         let recipient = Address::generate(&t.env);
//         let expires_at = t.now() + 3_600;

//         let result =
//             t.client
//                 .create_package(&1u64, &recipient, &100i128, &disallowed_token, &expires_at);

//         assert_eq!(result, Err(Ok(Error::InvalidState)));
//     }

//     // -----------------------------------------------------------------------
//     // Happy path (sanity check)
//     // -----------------------------------------------------------------------

//     #[test]
//     fn succeeds_with_valid_inputs() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);

//         let id = t.create_default_package(&recipient, 500);

//         let pkg = t.client.get_package(&id).unwrap();
//         assert_eq!(pkg.status, PackageStatus::Created);
//         assert_eq!(pkg.amount, 500);
//         assert_eq!(pkg.recipient, recipient);
//     }
// }

// // ===========================================================================
// // claim — error paths
// // ===========================================================================

// mod claim {
//     use super::*;

//     // -----------------------------------------------------------------------
//     // Package not found
//     // -----------------------------------------------------------------------

//     #[test]
//     fn fails_when_package_does_not_exist() {
//         let t = TestSetup::new();

//         let result = t.client.claim(&9999u64);

//         assert_eq!(result, Err(Ok(Error::PackageNotFound)));
//     }

//     // -----------------------------------------------------------------------
//     // Already claimed
//     // -----------------------------------------------------------------------

//     #[test]
//     fn fails_when_package_already_claimed() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);

//         let id = t.create_default_package(&recipient, 200);

//         // First claim succeeds.
//         t.client.claim(&id).unwrap();

//         // Second claim on the same package must fail.
//         let result = t.client.claim(&id);

//         assert_eq!(result, Err(Ok(Error::PackageNotActive)));
//     }

//     // -----------------------------------------------------------------------
//     // Expired package
//     // -----------------------------------------------------------------------

//     #[test]
//     fn fails_when_package_is_expired() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 150);

//         // Wind the clock past the expiry (create_default_package sets expires_at = now + 3600).
//         t.advance_time(3_601);

//         let result = t.client.claim(&id);

//         assert_eq!(result, Err(Ok(Error::PackageExpired)));
//     }

//     /// After a claim attempt on an expired package the status must be
//     /// persisted as Expired, not left as Created.
//     #[test]
//     fn auto_expires_package_status_on_late_claim() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 150);

//         t.advance_time(3_601);
//         let _ = t.client.claim(&id); // will return PackageExpired

//         let pkg = t.client.get_package(&id).unwrap();
//         assert_eq!(pkg.status, PackageStatus::Expired);
//     }

//     // -----------------------------------------------------------------------
//     // Revoked (Cancelled) package
//     // -----------------------------------------------------------------------

//     #[test]
//     fn fails_when_package_has_been_revoked() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 100);

//         t.client.revoke(&id).unwrap();

//         let result = t.client.claim(&id);
//         assert_eq!(result, Err(Ok(Error::PackageNotActive)));
//     }

//     // -----------------------------------------------------------------------
//     // Happy path (sanity check)
//     // -----------------------------------------------------------------------

//     #[test]
//     fn succeeds_when_recipient_claims_within_window() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 300);

//         t.client.claim(&id).unwrap();

//         let pkg = t.client.get_package(&id).unwrap();
//         assert_eq!(pkg.status, PackageStatus::Claimed);

//         // Recipient must have received the funds.
//         let token_client = TokenClient::new(&t.env, &t.token);
//         assert_eq!(token_client.balance(&recipient), 300);
//     }

//     /// Claiming at exactly the expiry second (timestamp == expires_at) is
//     /// still valid — the contract only expires when timestamp > expires_at.
//     #[test]
//     fn succeeds_when_claimed_at_exact_expiry_boundary() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 100);

//         // Move to exactly expires_at (not past it).
//         t.advance_time(3_600);

//         let result = t.client.claim(&id);
//         assert_eq!(result, Ok(()));
//     }
// }

// // ===========================================================================
// // Additional edge-case coverage
// // ===========================================================================

// mod edge_cases {
//     use super::*;

//     /// batch_create_packages must reject mismatched recipient/amount slices.
//     #[test]
//     fn batch_create_fails_on_mismatched_arrays() {
//         let t = TestSetup::new();
//         t.fund_contract(1_000);

//         let mut recipients = Vec::new(&t.env);
//         recipients.push_back(Address::generate(&t.env));
//         recipients.push_back(Address::generate(&t.env));

//         let mut amounts = Vec::new(&t.env);
//         amounts.push_back(100i128); // only one amount for two recipients

//         let result = t
//             .client
//             .batch_create_packages(&recipients, &amounts, &t.token, &3_600u64);

//         assert_eq!(result, Err(Ok(Error::MismatchedArrays)));
//     }

//     /// extend_expiration must reject additional_time = 0.
//     #[test]
//     fn extend_expiration_fails_when_additional_time_is_zero() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 100);

//         let result = t.client.extend_expiration(&id, &0u64);
//         assert_eq!(result, Err(Ok(Error::InvalidAmount)));
//     }

//     /// extend_expiration must reject already-expired packages.
//     #[test]
//     fn extend_expiration_fails_when_package_already_expired() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 100);

//         t.advance_time(3_601); // past expiry

//         let result = t.client.extend_expiration(&id, &3_600u64);
//         assert_eq!(result, Err(Ok(Error::PackageExpired)));
//     }

//     /// cancel_package must reject a package that has already been claimed.
//     #[test]
//     fn cancel_package_fails_when_already_claimed() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 100);

//         t.client.claim(&id).unwrap();

//         let result = t.client.cancel_package(&id);
//         assert_eq!(result, Err(Ok(Error::PackageNotActive)));
//     }

//     /// refund must fail when the package is still Created and not expired —
//     /// admin must revoke first.
//     #[test]
//     fn refund_fails_on_active_non_expired_package() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 100);

//         let result = t.client.refund(&id);
//         assert_eq!(result, Err(Ok(Error::InvalidState)));
//     }

//     /// refund succeeds on a package that has naturally expired.
//     #[test]
//     fn refund_succeeds_on_expired_package() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);
//         let id = t.create_default_package(&recipient, 200);

//         t.advance_time(3_601); // past expiry

//         t.client.refund(&id).unwrap();

//         let pkg = t.client.get_package(&id).unwrap();
//         assert_eq!(pkg.status, PackageStatus::Refunded);
//     }

//     /// Funds locked map must be correctly decremented after a claim so a
//     /// subsequent new package can use those freed funds.
//     #[test]
//     fn locked_funds_released_after_claim_allows_new_package() {
//         let t = TestSetup::new();
//         let recipient = Address::generate(&t.env);

//         // Fund contract with exactly 100.
//         t.fund_contract(100);
//         let expires_at = t.now() + 3_600;

//         t.client
//             .create_package(&1u64, &recipient, &100i128, &t.token, &expires_at)
//             .unwrap();

//         // All 100 are locked — creating another package should fail.
//         let r2 = t
//             .client
//             .create_package(&2u64, &recipient, &50i128, &t.token, &expires_at);
//         assert_eq!(r2, Err(Ok(Error::InsufficientFunds)));

//         // After claiming, 100 leave the contract entirely.
//         t.client.claim(&1u64).unwrap();

//         // Fund another 50 and verify a new package can now be created.
//         t.fund_contract(50);
//         let r3 = t
//             .client
//             .create_package(&3u64, &recipient, &50i128, &t.token, &expires_at);
//         assert!(r3.is_ok());
//     }
// }
