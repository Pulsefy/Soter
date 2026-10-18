#![cfg(test)]

//! Hardening tests for the Merkle-allowlist claim gate (`claim_with_proof`).
//!
//! `tests/aid_escrow_tests.rs::claim` only covers single-leaf trees (root ==
//! leaf, empty proof). These tests exercise the actual sibling-hash climb in
//! `AidEscrow::verify_merkle_proof_for_claimant` with a real multi-level
//! tree, plus the adversarial inputs an allowlist gate must reject
//! deterministically: tampered siblings, malformed hex, wrong claimant,
//! reordered proof steps, and a malformed root at package-creation time.

use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, Bytes, Env, Map, String as SorobanString, Symbol, Vec,
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
        client.set_config(&Config {
            min_amount: 1,
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
}

// ===========================================================================
// A tiny, test-side re-implementation of the contract's sorted-pair Merkle
// scheme (sha256 leaves/nodes, siblings combined in sorted byte order). Any
// tree built this way produces proofs that `verify_merkle_proof_for_claimant`
// must accept, since the contract climbs the same way.
// ===========================================================================

fn hash_address(env: &Env, address: &Address) -> [u8; 32] {
    let addr = address.to_string();
    let len = addr.len() as usize;
    let mut raw = [0u8; 96];
    addr.copy_into_slice(&mut raw[..len]);

    let mut data = Bytes::new(env);
    for b in raw[..len].iter() {
        data.push_back(*b);
    }

    env.crypto().sha256(&data).to_array()
}

fn combine(env: &Env, a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    let (left, right) = if a <= b { (a, b) } else { (b, a) };
    let mut data = Bytes::new(env);
    for x in left.iter() {
        data.push_back(*x);
    }
    for x in right.iter() {
        data.push_back(*x);
    }
    env.crypto().sha256(&data).to_array()
}

fn to_hex(bytes: [u8; 32]) -> std::string::String {
    let mut out = std::string::String::with_capacity(64);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn sstr(env: &Env, s: &str) -> SorobanString {
    SorobanString::from_str(env, s)
}

/// A 4-leaf sorted Merkle tree built from 4 claimant addresses.
struct FourLeafTree {
    root_hex: std::string::String,
    /// `proofs[i]` is the bottom-up sibling path (hex-encoded) for `leaves[i]`.
    proofs: [Vec<SorobanString>; 4],
}

fn build_four_leaf_tree(env: &Env, claimants: &[Address; 4]) -> FourLeafTree {
    let leaves: [[u8; 32]; 4] = [
        hash_address(env, &claimants[0]),
        hash_address(env, &claimants[1]),
        hash_address(env, &claimants[2]),
        hash_address(env, &claimants[3]),
    ];

    let n01 = combine(env, leaves[0], leaves[1]);
    let n23 = combine(env, leaves[2], leaves[3]);
    let root = combine(env, n01, n23);

    let mut proof0 = Vec::new(env);
    proof0.push_back(sstr(env, &to_hex(leaves[1])));
    proof0.push_back(sstr(env, &to_hex(n23)));

    let mut proof1 = Vec::new(env);
    proof1.push_back(sstr(env, &to_hex(leaves[0])));
    proof1.push_back(sstr(env, &to_hex(n23)));

    let mut proof2 = Vec::new(env);
    proof2.push_back(sstr(env, &to_hex(leaves[3])));
    proof2.push_back(sstr(env, &to_hex(n01)));

    let mut proof3 = Vec::new(env);
    proof3.push_back(sstr(env, &to_hex(leaves[2])));
    proof3.push_back(sstr(env, &to_hex(n01)));

    FourLeafTree {
        root_hex: to_hex(root),
        proofs: [proof0, proof1, proof2, proof3],
    }
}

fn merkle_metadata(env: &Env, root_hex: &str) -> Map<Symbol, SorobanString> {
    let mut metadata = Map::new(env);
    metadata.set(Symbol::new(env, "merkle_root"), sstr(env, root_hex));
    metadata
}

// ===========================================================================
// Multi-level proof verification (the actual sibling-hash climb)
// ===========================================================================

mod multi_level_tree {
    use super::*;

    #[test]
    fn valid_proof_at_every_leaf_position_succeeds() {
        // One package per leaf so each claimant gets its own pool to claim
        // from (a package can only be claimed once, regardless of how many
        // addresses are on its allowlist).
        for leaf_index in 0..4usize {
            let t = TestSetup::new();
            let claimants: [Address; 4] = [
                Address::generate(&t.env),
                Address::generate(&t.env),
                Address::generate(&t.env),
                Address::generate(&t.env),
            ];
            let tree = build_four_leaf_tree(&t.env, &claimants);
            t.fund_contract(ONE_TOKEN);

            let metadata = merkle_metadata(&t.env, &tree.root_hex);
            let id = t.client.create_package(
                &t.admin,
                &(900u64 + leaf_index as u64),
                &Address::generate(&t.env),
                &ONE_TOKEN,
                &t.token,
                &(t.now() + 3600),
                &metadata,
            );

            let result = t.client.try_claim_with_proof(
                &id,
                &claimants[leaf_index],
                &tree.proofs[leaf_index],
            );
            assert!(
                result.is_ok(),
                "leaf {leaf_index} should verify against the tree root"
            );
            assert_eq!(t.client.get_package(&id).status, PackageStatus::Claimed);
        }
    }

    #[test]
    fn valid_proof_cannot_be_replayed_against_an_already_claimed_package() {
        let t = TestSetup::new();
        let claimants: [Address; 4] = [
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
        ];
        let tree = build_four_leaf_tree(&t.env, &claimants);
        t.fund_contract(ONE_TOKEN);

        let metadata = merkle_metadata(&t.env, &tree.root_hex);
        let id = t.client.create_package(
            &t.admin,
            &901u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        // First allowlisted claimant takes the (single) payout.
        assert!(t
            .client
            .try_claim_with_proof(&id, &claimants[2], &tree.proofs[2])
            .is_ok());

        // A different, equally valid allowlist member cannot also claim it.
        let second = t
            .client
            .try_claim_with_proof(&id, &claimants[0], &tree.proofs[0]);
        assert_eq!(second, Err(Ok(Error::PackageNotActive)));
    }

    #[test]
    fn tampered_sibling_hash_is_rejected_deterministically() {
        let t = TestSetup::new();
        let claimants: [Address; 4] = [
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
        ];
        let tree = build_four_leaf_tree(&t.env, &claimants);
        t.fund_contract(ONE_TOKEN);

        let metadata = merkle_metadata(&t.env, &tree.root_hex);
        let id = t.client.create_package(
            &t.admin,
            &902u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        // Flip one hex nibble in the first sibling of a valid proof.
        let mut tampered_first = tree.proofs[1].get(0).unwrap().to_string();
        let last_char = tampered_first.pop().unwrap();
        let flipped = if last_char == '0' { '1' } else { '0' };
        tampered_first.push(flipped);

        let mut tampered_proof: Vec<SorobanString> = Vec::new(&t.env);
        tampered_proof.push_back(sstr(&t.env, &tampered_first));
        tampered_proof.push_back(tree.proofs[1].get(1).unwrap());

        let result = t
            .client
            .try_claim_with_proof(&id, &claimants[1], &tampered_proof);
        assert_eq!(result, Err(Ok(Error::InvalidProof)));
        assert_eq!(t.client.get_package(&id).status, PackageStatus::Created);
    }

    #[test]
    fn reordered_proof_siblings_are_rejected() {
        let t = TestSetup::new();
        let claimants: [Address; 4] = [
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
        ];
        let tree = build_four_leaf_tree(&t.env, &claimants);
        t.fund_contract(ONE_TOKEN);

        let metadata = merkle_metadata(&t.env, &tree.root_hex);
        let id = t.client.create_package(
            &t.admin,
            &903u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        // Swap the two proof steps: climbing sibling-then-parent out of
        // order must not accidentally reconstruct the same root.
        let mut reordered: Vec<SorobanString> = Vec::new(&t.env);
        reordered.push_back(tree.proofs[0].get(1).unwrap());
        reordered.push_back(tree.proofs[0].get(0).unwrap());

        let result = t
            .client
            .try_claim_with_proof(&id, &claimants[0], &reordered);
        assert_eq!(result, Err(Ok(Error::InvalidProof)));
    }

    #[test]
    fn proof_for_a_different_claimant_is_rejected() {
        let t = TestSetup::new();
        let claimants: [Address; 4] = [
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
        ];
        let tree = build_four_leaf_tree(&t.env, &claimants);
        t.fund_contract(ONE_TOKEN);

        let metadata = merkle_metadata(&t.env, &tree.root_hex);
        let id = t.client.create_package(
            &t.admin,
            &904u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        // claimants[3]'s valid proof, presented by an unrelated address.
        let outsider = Address::generate(&t.env);
        let result = t
            .client
            .try_claim_with_proof(&id, &outsider, &tree.proofs[3]);
        assert_eq!(result, Err(Ok(Error::InvalidProof)));
    }

    #[test]
    fn malformed_hex_proof_entry_is_rejected_not_panicked() {
        let t = TestSetup::new();
        let claimants: [Address; 4] = [
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
        ];
        let tree = build_four_leaf_tree(&t.env, &claimants);
        t.fund_contract(ONE_TOKEN);

        let metadata = merkle_metadata(&t.env, &tree.root_hex);
        let id = t.client.create_package(
            &t.admin,
            &905u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        // Not-hex characters.
        let mut bad_chars: Vec<SorobanString> = Vec::new(&t.env);
        bad_chars.push_back(sstr(&t.env, &"zz".repeat(32)));
        bad_chars.push_back(tree.proofs[0].get(1).unwrap());
        let result = t
            .client
            .try_claim_with_proof(&id, &claimants[0], &bad_chars);
        assert_eq!(result, Err(Ok(Error::InvalidProof)));

        // Right characters, wrong length (63 chars instead of 64).
        let mut bad_len: Vec<SorobanString> = Vec::new(&t.env);
        let short = tree.proofs[0].get(0).unwrap().to_string();
        bad_len.push_back(sstr(&t.env, &short[..63]));
        bad_len.push_back(tree.proofs[0].get(1).unwrap());
        let result = t.client.try_claim_with_proof(&id, &claimants[0], &bad_len);
        assert_eq!(result, Err(Ok(Error::InvalidProof)));

        // Package must still be claimable with the real proof afterwards —
        // rejected attempts must not have mutated any state.
        assert!(t
            .client
            .try_claim_with_proof(&id, &claimants[0], &tree.proofs[0])
            .is_ok());
    }

    #[test]
    fn empty_proof_against_a_multi_leaf_root_is_rejected() {
        let t = TestSetup::new();
        let claimants: [Address; 4] = [
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
            Address::generate(&t.env),
        ];
        let tree = build_four_leaf_tree(&t.env, &claimants);
        t.fund_contract(ONE_TOKEN);

        let metadata = merkle_metadata(&t.env, &tree.root_hex);
        let id = t.client.create_package(
            &t.admin,
            &906u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );

        let empty: Vec<SorobanString> = Vec::new(&t.env);
        let result = t.client.try_claim_with_proof(&id, &claimants[0], &empty);
        assert_eq!(result, Err(Ok(Error::InvalidProof)));
    }
}

// ===========================================================================
// Malformed `merkle_root` metadata must be rejected at creation time, not
// silently downgrade the package to an unrestricted direct claim.
// ===========================================================================

mod malformed_root_at_creation {
    use super::*;

    #[test]
    fn create_package_rejects_non_hex_merkle_root() {
        let t = TestSetup::new();
        t.fund_contract(ONE_TOKEN);

        let mut metadata = Map::new(&t.env);
        metadata.set(
            Symbol::new(&t.env, "merkle_root"),
            sstr(
                &t.env,
                "not-a-hex-root-but-64-characters-long-padded-out-xxxxxxxxxxx",
            ),
        );

        let result = t.client.try_create_package(
            &t.admin,
            &950u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );
        assert_eq!(result, Err(Ok(Error::InvalidMerkleRoot)));

        // No package was persisted for the rejected id.
        assert!(t.client.try_get_package(&950u64).is_err());
    }

    #[test]
    fn create_package_rejects_wrong_length_merkle_root() {
        let t = TestSetup::new();
        t.fund_contract(ONE_TOKEN);

        let mut metadata = Map::new(&t.env);
        // 63 hex chars instead of the required 64.
        metadata.set(
            Symbol::new(&t.env, "merkle_root"),
            sstr(&t.env, &"a".repeat(63)),
        );

        let result = t.client.try_create_package(
            &t.admin,
            &951u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );
        assert_eq!(result, Err(Ok(Error::InvalidMerkleRoot)));
    }

    #[test]
    fn batch_create_packages_rejects_malformed_merkle_root() {
        let t = TestSetup::new();
        t.fund_contract(ONE_TOKEN);

        let mut bad_metadata = Map::new(&t.env);
        bad_metadata.set(
            Symbol::new(&t.env, "merkle_root"),
            sstr(&t.env, &"zz".repeat(32)),
        );

        let recipients = Vec::from_array(&t.env, [Address::generate(&t.env)]);
        let amounts = Vec::from_array(&t.env, [ONE_TOKEN]);
        let metadatas = Vec::from_array(&t.env, [bad_metadata]);

        let result = t.client.try_batch_create_packages(
            &t.admin,
            &recipients,
            &amounts,
            &t.token,
            &3600u64,
            &metadatas,
        );
        assert_eq!(result, Err(Ok(Error::InvalidMerkleRoot)));
    }

    #[test]
    fn create_package_still_accepts_well_formed_merkle_root() {
        let t = TestSetup::new();
        t.fund_contract(ONE_TOKEN);
        let claimant = Address::generate(&t.env);
        let root_hex = to_hex(hash_address(&t.env, &claimant));

        let metadata = merkle_metadata(&t.env, &root_hex);
        let result = t.client.try_create_package(
            &t.admin,
            &952u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn create_package_still_accepts_metadata_without_a_merkle_root() {
        let t = TestSetup::new();
        t.fund_contract(ONE_TOKEN);
        let metadata = Map::new(&t.env);

        let result = t.client.try_create_package(
            &t.admin,
            &953u64,
            &Address::generate(&t.env),
            &ONE_TOKEN,
            &t.token,
            &(t.now() + 3600),
            &metadata,
        );
        assert!(result.is_ok());
    }
}
