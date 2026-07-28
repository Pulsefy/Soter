#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, Env, Map, Symbol, Vec,
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

fn diff_budget(before: &BudgetMetrics, after: &BudgetMetrics) -> BudgetMetrics {
    BudgetMetrics {
        cpu_instructions: after
            .cpu_instructions
            .saturating_sub(before.cpu_instructions),
        memory_bytes: after.memory_bytes.saturating_sub(before.memory_bytes),
    }
}

fn print_budget_metrics(operation: &str, metrics: &BudgetMetrics) {
    println!("=== {} ===", operation);
    println!("  CPU Instructions: {}", metrics.cpu_instructions);
    println!("  Memory Bytes: {}", metrics.memory_bytes);
    println!();
}

fn new_metadata(env: &Env) -> Map<Symbol, soroban_sdk::String> {
    Map::new(env)
}

// ===========================================================================
// Gas Profiling Tests
// ===========================================================================

#[test]
fn profile_single_create_package() {
    let t = TestSetup::new();
    let recipient = Address::generate(&t.env);

    t.fund_contract(ONE_TOKEN);

    let before = capture_budget(&t.env);

    let expires_at = t.now() + 3_600;
    let metadata = new_metadata(&t.env);
    let _package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics("Single create_package", &metrics);
}

#[test]
fn profile_single_claim() {
    let t = TestSetup::new();
    let recipient = Address::generate(&t.env);

    t.fund_contract(ONE_TOKEN);
    let expires_at = t.now() + 3_600;
    let metadata = new_metadata(&t.env);
    let package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    let before = capture_budget(&t.env);
    t.client.claim(&package_id);
    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics("Single claim", &metrics);
}

#[test]
fn profile_single_refund() {
    let t = TestSetup::new();
    let recipient = Address::generate(&t.env);

    t.fund_contract(ONE_TOKEN);
    let expires_at = t.now() + 3_600;
    let metadata = new_metadata(&t.env);
    let package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    t.env.ledger().with_mut(|li| li.timestamp = expires_at + 1);

    let before = capture_budget(&t.env);
    t.client.refund(&package_id);
    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics("Single refund", &metrics);
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

    let mut recipients: Vec<Address> = Vec::new(&t.env);
    let mut amounts: Vec<i128> = Vec::new(&t.env);
    let mut metadatas: Vec<Map<Symbol, soroban_sdk::String>> = Vec::new(&t.env);

    for _ in 0..batch_size {
        recipients.push_back(Address::generate(&t.env));
        amounts.push_back(ONE_TOKEN);
        metadatas.push_back(new_metadata(&t.env));
    }

    let total_amount = ONE_TOKEN * batch_size as i128;
    t.fund_contract(total_amount);

    let before = capture_budget(&t.env);

    t.client
        .batch_create_packages(&t.admin, &recipients, &amounts, &t.token, &3600, &metadatas);

    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics(
        &format!("Batch create_packages (size: {})", batch_size),
        &metrics,
    );

    let per_package_cpu = metrics.cpu_instructions / batch_size as u64;
    let per_package_memory = metrics.memory_bytes / batch_size as u64;

    println!("  Per-package CPU: {}", per_package_cpu);
    println!("  Per-package Memory: {}", per_package_memory);
    println!();
}

#[test]
fn profile_claim_with_proof() {
    let t = TestSetup::new();
    let claimant = Address::generate(&t.env);

    t.fund_contract(ONE_TOKEN);

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

    let mut metadata = new_metadata(&t.env);
    metadata.set(
        Symbol::new(&t.env, "merkle_root"),
        soroban_sdk::String::from_str(&t.env, &root_hex),
    );

    let expires_at = t.now() + 3_600;
    let package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &Address::generate(&t.env),
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    let before = capture_budget(&t.env);
    let proof: Vec<soroban_sdk::String> = Vec::new(&t.env);
    t.client.claim_with_proof(&package_id, &claimant, &proof);
    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics("Claim with Merkle proof", &metrics);
}

#[test]
fn profile_fund_operation() {
    let t = TestSetup::new();

    t.token_sac.mint(&t.admin, &(ONE_TOKEN * 100));

    let before = capture_budget(&t.env);
    t.client.fund(&t.token, &t.admin, &ONE_TOKEN);
    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics("Fund operation (1 token)", &metrics);
}

#[test]
fn profile_get_package() {
    let t = TestSetup::new();
    let recipient = Address::generate(&t.env);

    t.fund_contract(ONE_TOKEN);
    let expires_at = t.now() + 3_600;
    let metadata = new_metadata(&t.env);
    let package_id = t.client.create_package(
        &t.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &t.token,
        &expires_at,
        &metadata,
    );

    let before = capture_budget(&t.env);
    t.client.get_package(&package_id);
    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics("Get package", &metrics);
}

#[test]
fn profile_get_aggregates() {
    let t = TestSetup::new();

    let batch_size = 50;
    let mut recipients: Vec<Address> = Vec::new(&t.env);
    let mut amounts: Vec<i128> = Vec::new(&t.env);
    let mut metadatas: Vec<Map<Symbol, soroban_sdk::String>> = Vec::new(&t.env);

    for _ in 0..batch_size {
        recipients.push_back(Address::generate(&t.env));
        amounts.push_back(ONE_TOKEN);
        metadatas.push_back(new_metadata(&t.env));
    }

    let total_amount = ONE_TOKEN * batch_size as i128;
    t.fund_contract(total_amount);

    t.client
        .batch_create_packages(&t.admin, &recipients, &amounts, &t.token, &3600, &metadatas);

    let before = capture_budget(&t.env);
    t.client.get_aggregates(&t.token);
    let after = capture_budget(&t.env);
    let metrics = diff_budget(&before, &after);

    print_budget_metrics(
        &format!("Get aggregates ({} packages)", batch_size),
        &metrics,
    );
}
