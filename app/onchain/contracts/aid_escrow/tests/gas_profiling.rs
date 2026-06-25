#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, Env, Map, Vec,
};

// ---------------------------------------------------------------------------
// Constants for 7-decimal tokens (Standard Stellar Asset)
// ---------------------------------------------------------------------------
const ONE_TOKEN: i128 = 10_000_000;

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
}

// ---------------------------------------------------------------------------
// Budget tracking helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct BudgetMetrics {
    cpu_instructions: u64,
    memory_bytes: u64,
}

fn capture_budget(env: &Env) -> BudgetMetrics {
    let budget = env.cost_estimate().budget();
    BudgetMetrics {
        cpu_instructions: budget.cpu_instruction_cost(),
        memory_bytes: budget.memory_bytes_cost(),
    }
}

fn print_budget_metrics(operation: &str, metrics: &BudgetMetrics) {
    println!("=== {} ===", operation);
    println!("  CPU Instructions: {}", metrics.cpu_instructions);
    println!("  Memory Bytes: {}", metrics.memory_bytes);
    println!();
}

// ===========================================================================
// Gas Profiling Tests
// ===========================================================================

#[test]
fn profile_single_create_package() {
    let t = TestSetup::new();
    let recipient = Address::generate(&t.env);

    // Fund contract
    t.fund_contract(ONE_TOKEN);

    // Capture initial budget
    let before = capture_budget(&t.env);

    // Create package
    let expires_at = t.now() + 3_600;
    let metadata = Map::new(&t.env);
    let _package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    // Capture final budget
    let after = capture_budget(&t.env);

    let metrics = BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    };

    print_budget_metrics("Single create_package", &metrics);
}

#[test]
fn profile_batch_create_packages_10() {
    profile_batch_create(10);
}

#[test]
fn profile_batch_create_packages_25() {
    profile_batch_create(25);
}

#[test]
fn profile_batch_create_packages_50() {
    profile_batch_create(50);
}

#[test]
fn profile_batch_create_packages_100() {
    profile_batch_create(100);
}

#[test]
fn profile_batch_create_packages_200() {
    profile_batch_create(200);
}

fn profile_batch_create(batch_size: u32) {
    let t = TestSetup::new();

    // Prepare recipients and amounts
    let mut recipients: Vec<Address> = Vec::new(&t.env);
    let mut amounts: Vec<i128> = Vec::new(&t.env);
    let mut metadatas: Vec<Map<soroban_sdk::Symbol, soroban_sdk::String>> = Vec::new(&t.env);

    for _ in 0..batch_size {
        recipients.push_back(Address::generate(&t.env));
        amounts.push_back(ONE_TOKEN);
        metadatas.push_back(Map::new(&t.env));
    }

    // Fund contract with enough tokens
    let total_amount = ONE_TOKEN * batch_size as i128;
    t.fund_contract(total_amount);

    // Capture initial budget
    let before = capture_budget(&t.env);

    // Batch create packages
    t.client
        .batch_create_packages(&t.admin, &recipients, &amounts, &t.token, &3600, &metadatas);

    // Capture final budget
    let after = capture_budget(&t.env);

    let metrics = BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    };

    print_budget_metrics(
        &format!("Batch create_packages (size: {})", batch_size),
        &metrics,
    );

    // Calculate per-package metrics
    let per_package_cpu = metrics.cpu_instructions / batch_size as u64;
    let per_package_memory = metrics.memory_bytes / batch_size as u64;

    println!("  Per-package CPU: {}", per_package_cpu);
    println!("  Per-package Memory: {}", per_package_memory);
    println!();
}

#[test]
fn profile_single_claim() {
    let t = TestSetup::new();
    let recipient = Address::generate(&t.env);

    // Create a package
    t.fund_contract(ONE_TOKEN);
    let expires_at = t.now() + 3_600;
    let metadata = Map::new(&t.env);
    let _package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    // Reset budget for claim operation
    let env = Env::default();
    env.ledger().set(default_ledger_info());
    env.mock_all_auths();

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    // Re-create the same package state in new environment
    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_id.address();
    let token_sac = StellarAssetClient::new(&env, &token);

    client.init(&admin);
    client.set_config(&Config {
        min_amount: 1,
        max_expires_in: 0,
        allowed_tokens: Vec::new(&env),
    });

    token_sac.mint(&client.address, &ONE_TOKEN);
    let recipient_new = Address::generate(&env);
    let expires_at_new = env.ledger().timestamp() + 3_600;
    let metadata_new = Map::new(&env);
    let package_id_new = client.create_package(
        &admin,
        &1u64,
        &recipient_new,
        &ONE_TOKEN,
        &token,
        &expires_at_new,
        &metadata_new,
    );

    // Capture initial budget
    let before = capture_budget(&env);

    // Claim package
    client.claim(&package_id_new);

    // Capture final budget
    let after = capture_budget(&env);

    let metrics = BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    };

    print_budget_metrics("Single claim", &metrics);
}

#[test]
fn profile_claim_with_proof() {
    let t = TestSetup::new();
    let claimant = Address::generate(&t.env);

    // Fund contract
    t.fund_contract(ONE_TOKEN);

    // Create Merkle root for single leaf (claimant)
    let addr = claimant.to_string();
    let len = addr.len() as usize;
    let mut raw = [0u8; 96];
    addr.copy_into_slice(&mut raw[..len]);

    let mut data = soroban_sdk::Bytes::new(&t.env);
    for b in raw[..len].iter() {
        data.push_back(*b);
    }

    let digest = t.env.crypto().sha256(&data);
    let hash = digest.to_array();

    let mut root_hex = String::new();
    for b in hash {
        root_hex.push_str(&format!("{:02x}", b));
    }

    // Create package with Merkle root
    let mut metadata = Map::new(&t.env);
    metadata.set(
        soroban_sdk::Symbol::new(&t.env, "merkle_root"),
        soroban_sdk::String::from_str(&t.env, &root_hex),
    );

    let expires_at = t.now() + 3_600;
    let _package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &Address::generate(&t.env),
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    // Reset environment for clean claim measurement
    let env = Env::default();
    env.ledger().set(default_ledger_info());
    env.mock_all_auths();

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_id.address();
    let token_sac = StellarAssetClient::new(&env, &token);

    client.init(&admin);
    client.set_config(&Config {
        min_amount: 1,
        max_expires_in: 0,
        allowed_tokens: Vec::new(&env),
    });

    token_sac.mint(&client.address, &ONE_TOKEN);

    let claimant_new = Address::generate(&env);
    let addr_new = claimant_new.to_string();
    let len_new = addr_new.len() as usize;
    let mut raw_new = [0u8; 96];
    addr_new.copy_into_slice(&mut raw_new[..len_new]);

    let mut data_new = soroban_sdk::Bytes::new(&env);
    for b in raw_new[..len_new].iter() {
        data_new.push_back(*b);
    }

    let digest_new = env.crypto().sha256(&data_new);
    let hash_new = digest_new.to_array();

    let mut root_hex_new = String::new();
    for b in hash_new {
        root_hex_new.push_str(&format!("{:02x}", b));
    }

    let mut metadata_new = Map::new(&env);
    metadata_new.set(
        soroban_sdk::Symbol::new(&env, "merkle_root"),
        soroban_sdk::String::from_str(&env, &root_hex_new),
    );

    let expires_at_new = env.ledger().timestamp() + 3_600;
    let package_id_new = client.create_package(
        &admin,
        &1u64,
        &Address::generate(&env),
        &ONE_TOKEN,
        &token,
        &expires_at_new,
        &metadata_new,
    );

    // Capture initial budget
    let before = capture_budget(&env);

    // Claim with proof (empty proof for single leaf)
    let proof: Vec<soroban_sdk::String> = Vec::new(&env);
    client.claim_with_proof(&package_id_new, &claimant_new, &proof);

    // Capture final budget
    let after = capture_budget(&env);

    let metrics = BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    };

    print_budget_metrics("Claim with Merkle proof", &metrics);
}

#[test]
fn profile_fund_operation() {
    let t = TestSetup::new();

    // Mint tokens to admin first
    t.token_sac.mint(&t.admin, &(ONE_TOKEN * 100));

    // Capture initial budget
    let before = capture_budget(&t.env);

    // Fund contract
    t.client.fund(&t.token, &t.admin, &ONE_TOKEN);

    // Capture final budget
    let after = capture_budget(&t.env);

    let metrics = BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    };

    print_budget_metrics("Fund operation (1 token)", &metrics);
}

#[test]
fn profile_get_package() {
    let t = TestSetup::new();
    let recipient = Address::generate(&t.env);

    // Create a package
    t.fund_contract(ONE_TOKEN);
    let expires_at = t.now() + 3_600;
    let metadata = Map::new(&t.env);
    let _package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    // Capture initial budget
    let before = capture_budget(&t.env);

    // Get package
    t.client.get_package(&_package_id);

    // Capture final budget
    let after = capture_budget(&t.env);

    let metrics = BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    };

    print_budget_metrics("Get package", &metrics);
}

#[test]
fn profile_get_aggregates() {
    let t = TestSetup::new();

    // Create multiple packages
    let batch_size = 50;
    let mut recipients: Vec<Address> = Vec::new(&t.env);
    let mut amounts: Vec<i128> = Vec::new(&t.env);
    let mut metadatas: Vec<Map<soroban_sdk::Symbol, soroban_sdk::String>> = Vec::new(&t.env);

    for _ in 0..batch_size {
        recipients.push_back(Address::generate(&t.env));
        amounts.push_back(ONE_TOKEN);
        metadatas.push_back(Map::new(&t.env));
    }

    let total_amount = ONE_TOKEN * batch_size as i128;
    t.fund_contract(total_amount);

    t.client
        .batch_create_packages(&t.admin, &recipients, &amounts, &t.token, &3600, &metadatas);

    // Capture initial budget
    let before = capture_budget(&t.env);

    // Get aggregates
    t.client.get_aggregates(&t.token);

    // Capture final budget
    let after = capture_budget(&t.env);

    let metrics = BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    };

    print_budget_metrics(
        &format!("Get aggregates ({} packages)", batch_size),
        &metrics,
    );
}
