#![cfg(test)]

//! Multi-leaf Merkle allowlist proof verification tests for `claim_with_proof`.
//!
//! Mirrors the on-chain hashing scheme in `aid_escrow::AidEscrow`:
//! - leaf = sha256(stellar_address_string)
//! - parent = sha256(sorted_pair(left, right))

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, Env, Map, Symbol, Vec,
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

fn hash_pair(env: &Env, left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut data = Bytes::new(env);
    for b in left.iter() {
        data.push_back(*b);
    }
    for b in right.iter() {
        data.push_back(*b);
    }

    env.crypto().sha256(&data).to_array()
}

fn combine_nodes(env: &Env, left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    if left <= right {
        hash_pair(env, &left, &right)
    } else {
        hash_pair(env, &right, &left)
    }
}

fn bytes_to_hex(bytes: &[u8; 32]) -> String {
    let mut out = String::with_capacity(64);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

struct MerkleTree {
    layers: std::vec::Vec<std::vec::Vec<[u8; 32]>>,
    leaf_indices: std::collections::HashMap<[u8; 32], usize>,
}

impl MerkleTree {
    fn from_addresses(env: &Env, addresses: &[Address]) -> Self {
        let mut leaves: std::vec::Vec<[u8; 32]> = addresses
            .iter()
            .map(|addr| hash_address(env, addr))
            .collect();
        leaves.sort();

        let mut leaf_indices = std::collections::HashMap::new();
        for (idx, leaf) in leaves.iter().enumerate() {
            leaf_indices.insert(*leaf, idx);
        }

        let mut layers = vec![leaves.clone()];
        let mut current = leaves;

        while current.len() > 1 {
            let mut next = std::vec::Vec::new();
            let mut i = 0;
            while i < current.len() {
                if i + 1 < current.len() {
                    next.push(combine_nodes(env, current[i], current[i + 1]));
                    i += 2;
                } else {
                    next.push(combine_nodes(env, current[i], current[i]));
                    i += 1;
                }
            }
            layers.push(next.clone());
            current = next;
        }

        Self {
            layers,
            leaf_indices,
        }
    }

    fn root(&self) -> [u8; 32] {
        self.layers.last().expect("tree has root")[0]
    }

    fn proof_for_address(&self, env: &Env, address: &Address) -> Vec<soroban_sdk::String> {
        let leaf = hash_address(env, address);
        let mut index = *self
            .leaf_indices
            .get(&leaf)
            .expect("address must be in allowlist");

        let mut proof = Vec::new(env);
        for layer in self.layers.iter().take(self.layers.len().saturating_sub(1)) {
            let sibling_index = if index % 2 == 0 {
                index + 1
            } else {
                index.saturating_sub(1)
            };

            let sibling = if sibling_index < layer.len() {
                layer[sibling_index]
            } else {
                layer[index]
            };

            proof.push_back(soroban_sdk::String::from_str(
                env,
                &bytes_to_hex(&sibling),
            ));
            index /= 2;
        }

        proof
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

    fn create_merkle_package(
        &self,
        package_id: u64,
        root_hex: &str,
    ) -> u64 {
        self.fund_contract(ONE_TOKEN);
        let mut metadata = Map::new(&self.env);
        metadata.set(
            Symbol::new(&self.env, "merkle_root"),
            soroban_sdk::String::from_str(&self.env, root_hex),
        );

        self.client.create_package(
            &self.admin,
            &package_id,
            &Address::generate(&self.env),
            &ONE_TOKEN,
            &self.token,
            &(self.now() + 3600),
            &metadata,
        )
    }
}

#[test]
fn merkle_multi_leaf_claim_succeeds_with_valid_proof() {
    let t = TestSetup::new();
    let a1 = Address::generate(&t.env);
    let a2 = Address::generate(&t.env);
    let a3 = Address::generate(&t.env);
    let claimant = a2.clone();

    let tree = MerkleTree::from_addresses(&t.env, &[a1, a2, a3]);
    let root_hex = bytes_to_hex(&tree.root());
    let id = t.create_merkle_package(901, &root_hex);

    let direct = t.client.try_claim(&id);
    assert_eq!(direct, Err(Ok(Error::InvalidProof)));

    let proof = tree.proof_for_address(&t.env, &claimant);
    let with_proof = t.client.try_claim_with_proof(&id, &claimant, &proof);
    assert!(with_proof.is_ok());

    let token_client = TokenClient::new(&t.env, &t.token);
    assert_eq!(token_client.balance(&claimant), ONE_TOKEN);
    assert_eq!(t.client.get_package(&id).status, PackageStatus::Claimed);
}

#[test]
fn merkle_multi_leaf_claim_fails_for_non_member() {
    let t = TestSetup::new();
    let a1 = Address::generate(&t.env);
    let a2 = Address::generate(&t.env);
    let a3 = Address::generate(&t.env);
    let outsider = Address::generate(&t.env);

    let tree = MerkleTree::from_addresses(&t.env, &[a1.clone(), a2, a3]);
    let root_hex = bytes_to_hex(&tree.root());
    let id = t.create_merkle_package(902, &root_hex);

    let proof = tree.proof_for_address(&t.env, &a1);
    let result = t.client.try_claim_with_proof(&id, &outsider, &proof);
    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}

#[test]
fn merkle_multi_leaf_claim_fails_with_tampered_sibling() {
    let t = TestSetup::new();
    let a1 = Address::generate(&t.env);
    let a2 = Address::generate(&t.env);
    let a3 = Address::generate(&t.env);
    let claimant = a2.clone();

    let tree = MerkleTree::from_addresses(&t.env, &[a1, a2, a3]);
    let root_hex = bytes_to_hex(&tree.root());
    let id = t.create_merkle_package(903, &root_hex);

    let mut proof = tree.proof_for_address(&t.env, &claimant);
    let tampered = soroban_sdk::String::from_str(
        &t.env,
        "0000000000000000000000000000000000000000000000000000000000000001",
    );
    proof.set(0, tampered);

    let result = t.client.try_claim_with_proof(&id, &claimant, &proof);
    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}

#[test]
fn merkle_multi_leaf_claim_fails_with_proof_for_different_leaf() {
    let t = TestSetup::new();
    let a1 = Address::generate(&t.env);
    let a2 = Address::generate(&t.env);
    let a3 = Address::generate(&t.env);

    let tree = MerkleTree::from_addresses(&t.env, &[a1.clone(), a2.clone(), a3]);
    let root_hex = bytes_to_hex(&tree.root());
    let id = t.create_merkle_package(904, &root_hex);

    // Proof is valid for a1 but presented by a2.
    let proof = tree.proof_for_address(&t.env, &a1);
    let result = t.client.try_claim_with_proof(&id, &a2, &proof);
    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}

#[test]
fn merkle_multi_leaf_claim_fails_with_malformed_proof_hex() {
    let t = TestSetup::new();
    let a1 = Address::generate(&t.env);
    let a2 = Address::generate(&t.env);

    let tree = MerkleTree::from_addresses(&t.env, &[a1.clone(), a2]);
    let root_hex = bytes_to_hex(&tree.root());
    let id = t.create_merkle_package(905, &root_hex);

    let mut proof = Vec::new(&t.env);
    proof.push_back(soroban_sdk::String::from_str(&t.env, "not-valid-hex"));

    let result = t.client.try_claim_with_proof(&id, &a1, &proof);
    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}
