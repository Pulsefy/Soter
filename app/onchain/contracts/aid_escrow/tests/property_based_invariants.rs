#![cfg(test)]
#![allow(clippy::all)]
#![allow(dead_code)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

const UNIT: i128 = 10_000_000;

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

fn setup_env() -> (
    Env,
    AidEscrowClient<'static>,
    Address,
    Address,
    StellarAssetClient<'static>,
    TokenClient<'static>,
) {
    let env = Env::default();
    env.ledger().set(default_ledger_info());
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    client.set_config(&Config {
        min_amount: 1,
        max_expires_in: 0,
        allowed_tokens: soroban_sdk::Vec::new(&env),
    });

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let token_sac = StellarAssetClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);

    (env, client, admin, token, token_sac, token_client)
}

fn advance_time(env: &Env, seconds: u64) {
    let mut info = env.ledger().get();
    info.timestamp += seconds;
    env.ledger().set(info);
}

// --- Invariant assertion ---

fn assert_invariants(
    client: &AidEscrowClient,
    token_client: &TokenClient,
    token: &Address,
    total_funded: i128,
    total_refunded: i128,
    total_withdrawn: i128,
    iteration: u64,
    step: usize,
    seed: u64,
    ops: &[(usize, String, bool, String)],
) {
    let locked = client.get_total_locked(token);
    let claimed = client.get_total_claimed(token);
    let balance = token_client.balance(&client.address);

    // (1) total_locked + total_claimed + total_refunded + total_withdrawn <= total_funded
    let accounted = locked + claimed + total_refunded + total_withdrawn;
    if accounted > total_funded {
        dump_failure(
            iteration,
            seed,
            ops,
            client,
            token_client,
            token,
            total_funded,
            total_refunded,
            total_withdrawn,
        );
        panic!(
            "inv(1) violated at iter={} step={}: locked={} + claimed={} + refunded={} + withdrawn={} = {} > funded={}",
            iteration, step, locked, claimed, total_refunded, total_withdrawn, accounted, total_funded,
        );
    }

    // (2) contract token balance >= total_locked (solvency)
    if balance < locked {
        dump_failure(
            iteration,
            seed,
            ops,
            client,
            token_client,
            token,
            total_funded,
            total_refunded,
            total_withdrawn,
        );
        panic!(
            "inv(2) violated at iter={} step={}: balance={} < locked={}",
            iteration, step, balance, locked,
        );
    }

    // (3) no negative i128 values
    if locked < 0
        || claimed < 0
        || total_refunded < 0
        || total_withdrawn < 0
        || total_funded < 0
        || balance < 0
    {
        dump_failure(
            iteration,
            seed,
            ops,
            client,
            token_client,
            token,
            total_funded,
            total_refunded,
            total_withdrawn,
        );
        panic!(
            "inv(3) violated at iter={} step={}: locked={} claimed={} refunded={} withdrawn={} funded={} balance={}",
            iteration, step, locked, claimed, total_refunded, total_withdrawn, total_funded, balance,
        );
    }

    // (4) LIFETIME conservation: claimed (cumulative) + refunded + withdrawn <= funded
    // NOTE: total_locked is CURRENT balance, total_claimed is CUMULATIVE lifetime.
    // So claimed can exceed locked. Correct invariant: claimed+refunded+withdrawn <= funded.
    let lifetime_accounted = claimed + total_refunded + total_withdrawn;
    if lifetime_accounted > total_funded {
        dump_failure(
            iteration,
            seed,
            ops,
            client,
            token_client,
            token,
            total_funded,
            total_refunded,
            total_withdrawn,
        );
        panic!(
            "inv(4) violated at iter={} step={}: claimed(cum)={} + refunded={} + withdrawn={} = {} > funded={}",
            iteration, step, claimed, total_refunded, total_withdrawn, lifetime_accounted, total_funded,
        );
    }

    // Check invariants after each step
    let _ = (locked, claimed, balance, accounted);
}

fn dump_failure(
    iteration: u64,
    seed: u64,
    ops: &[(usize, String, bool, String)],
    client: &AidEscrowClient,
    token_client: &TokenClient,
    token: &Address,
    total_funded: i128,
    total_refunded: i128,
    total_withdrawn: i128,
) {
    eprintln!("\n╔══════════════════ INVARIANT FAILURE ══════════════════╗");
    eprintln!("║ iteration: {:<44} ║", iteration);
    eprintln!("║ seed:      {:<44} ║", seed);
    eprintln!("╠══════════════════ OPERATION SEQUENCE ═════════════════╣");
    for (i, op, ok, err) in ops {
        let status = if *ok { "OK" } else { "FAIL" };
        eprintln!("║ {:>3}: {:<38} {:>4} {}", i, op, status, err);
    }
    eprintln!("╠══════════════════ STATE SNAPSHOT ═════════════════════╣");
    eprintln!(
        "║ total_locked:      {:<38} ║",
        client.get_total_locked(token)
    );
    eprintln!(
        "║ total_claimed:     {:<38} ║",
        client.get_total_claimed(token)
    );
    eprintln!(
        "║ contract_balance:  {:<38} ║",
        token_client.balance(&client.address)
    );
    eprintln!("║ total_funded:      {:<38} ║", total_funded);
    eprintln!("║ total_refunded:    {:<38} ║", total_refunded);
    eprintln!("║ total_withdrawn:   {:<38} ║", total_withdrawn);
    eprintln!("╚════════════════════════════════════════════════════════╝\n");
}

// ============================================================================
// test_fund_accounting_invariants
// ============================================================================

#[test]
fn test_fund_accounting_invariants() {
    const BASE_SEED: u64 = 0xABC0_0001;
    let mut rng = StdRng::seed_from_u64(BASE_SEED);

    for iter in 0..50 {
        let seed = rng.gen::<u64>();
        let mut iter_rng = StdRng::seed_from_u64(seed);
        let (env, client, admin, token, token_sac, token_client) = setup_env();

        let mut total_funded: i128 = 0;
        let total_refunded: i128 = 0;
        let mut total_withdrawn: i128 = 0;
        let mut next_pkg_id: u64 = 0;
        let mut pkg_list: Vec<(u64, Address, i128, u64)> = Vec::new();
        let mut ops_log: Vec<(usize, String, bool, String)> = Vec::new();

        let n_ops: usize = iter_rng.gen_range(10..=25);

        for step in 0..n_ops {
            let action = iter_rng.gen_range(0u32..100);

            if action < 40 {
                // FUND: mint some tokens and fund the contract
                let amount = UNIT * iter_rng.gen_range(1..=20) as i128;
                token_sac.mint(&admin, &amount);
                match client.try_fund(&token, &admin, &amount) {
                    Ok(Ok(())) => {
                        total_funded += amount;
                        ops_log.push((step, format!("fund({})", amount), true, String::new()));
                    }
                    other => {
                        let err = format!("{:?}", other);
                        ops_log.push((step, format!("fund({})", amount), false, err));
                    }
                }
            } else if action < 75 {
                // CREATE_PACKAGE: create a package from the available pool
                let amount = UNIT * iter_rng.gen_range(1..=5) as i128;
                let recipient = Address::generate(&env);
                let expires_in = iter_rng.gen_range(1..=7200) as u64;
                let expires_at = env.ledger().timestamp() + expires_in;
                let pid = next_pkg_id;
                next_pkg_id += 1;

                match client.try_create_package(
                    &admin,
                    &pid,
                    &recipient,
                    &amount,
                    &token,
                    &expires_at,
                    &Map::new(&env),
                ) {
                    Ok(Ok(_)) => {
                        pkg_list.push((pid, recipient, amount, expires_at));
                        ops_log.push((
                            step,
                            format!("create(pkg={}, amt={}, exp={})", pid, amount, expires_at),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("create(pkg={}, amt={})", pid, amount),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("create(pkg={}, amt={})", pid, amount),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else {
                // WITHDRAW_SURPLUS: try to pull surplus
                let amount = UNIT * iter_rng.gen_range(1..=3) as i128;
                let to = Address::generate(&env);
                match client.try_withdraw_surplus(&to, &amount, &token) {
                    Ok(Ok(())) => {
                        total_withdrawn += amount;
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            }

            assert_invariants(
                &client,
                &token_client,
                &token,
                total_funded,
                total_refunded,
                total_withdrawn,
                iter as u64,
                step,
                seed,
                &ops_log,
            );
        }
    }
}

// ============================================================================
// test_claim_revolve_invariants
// ============================================================================

#[test]
fn test_claim_revolve_invariants() {
    const BASE_SEED: u64 = 0xDEF0_0002;
    let mut rng = StdRng::seed_from_u64(BASE_SEED);

    for iter in 0..80 {
        let seed = rng.gen::<u64>();
        let mut iter_rng = StdRng::seed_from_u64(seed);
        let (env, client, admin, token, token_sac, token_client) = setup_env();

        let mut total_funded: i128 = 0;
        let mut total_refunded: i128 = 0;
        let mut total_withdrawn: i128 = 0;
        let mut next_pkg_id: u64 = 0;
        let mut pkg_list: Vec<(u64, Address, i128, u64)> = Vec::new();
        let mut ops_log: Vec<(usize, String, bool, String)> = Vec::new();

        // Pre-fund with a large amount
        let pre_fund = UNIT * 100;
        token_sac.mint(&admin, &pre_fund);
        client.fund(&token, &admin, &pre_fund);
        total_funded += pre_fund;

        // Create 5-10 initial packages
        let n_init = iter_rng.gen_range(5..=10);
        for _ in 0..n_init {
            let amount = UNIT * iter_rng.gen_range(1..=10) as i128;
            let recipient = Address::generate(&env);
            let expires_in = iter_rng.gen_range(3600..=14400) as u64;
            let expires_at = env.ledger().timestamp() + expires_in;
            let pid = next_pkg_id;
            next_pkg_id += 1;

            match client.try_create_package(
                &admin,
                &pid,
                &recipient,
                &amount,
                &token,
                &expires_at,
                &Map::new(&env),
            ) {
                Ok(Ok(_)) => {
                    pkg_list.push((pid, recipient, amount, expires_at));
                }
                _ => {}
            }
        }

        let n_ops: usize = iter_rng.gen_range(15..=30);

        for step in 0..n_ops {
            let action = iter_rng.gen_range(0u32..100);

            if action < 30 && !pkg_list.is_empty() {
                // CLAIM a random package
                let idx = iter_rng.gen_range(0..pkg_list.len());
                let (pid, _recipient, _amount, _exp) = pkg_list[idx].clone();
                match client.try_claim(&pid) {
                    Ok(Ok(())) => {
                        pkg_list.remove(idx);
                        ops_log.push((step, format!("claim(pkg={})", pid), true, String::new()));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("claim(pkg={})", pid),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("claim(pkg={})", pid),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if action < 55 && !pkg_list.is_empty() {
                // REVOKE a random package
                let idx = iter_rng.gen_range(0..pkg_list.len());
                let (pid, _recipient, _amount, _exp) = pkg_list[idx].clone();
                match client.try_revoke(&pid) {
                    Ok(Ok(())) => {
                        pkg_list.remove(idx);
                        ops_log.push((step, format!("revoke(pkg={})", pid), true, String::new()));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("revoke(pkg={})", pid),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("revoke(pkg={})", pid),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if action < 70 && !pkg_list.is_empty() {
                // REFUND — advance time to trigger expiration, then refund
                let idx = iter_rng.gen_range(0..pkg_list.len());
                let (pid, _recipient, amount, expires_at) = pkg_list[idx].clone();
                let now = env.ledger().timestamp();
                if expires_at > 0 && now <= expires_at {
                    advance_time(&env, expires_at - now + 1);
                }
                match client.try_refund(&pid) {
                    Ok(Ok(())) => {
                        total_refunded += amount;
                        pkg_list.remove(idx);
                        ops_log.push((step, format!("refund(pkg={})", pid), true, String::new()));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("refund(pkg={})", pid),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("refund(pkg={})", pid),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if action < 85 {
                // CREATE more packages
                let amount = UNIT * iter_rng.gen_range(1..=5) as i128;
                let recipient = Address::generate(&env);
                let expires_in = iter_rng.gen_range(1..=7200) as u64;
                let expires_at = env.ledger().timestamp() + expires_in;
                let pid = next_pkg_id;
                next_pkg_id += 1;

                match client.try_create_package(
                    &admin,
                    &pid,
                    &recipient,
                    &amount,
                    &token,
                    &expires_at,
                    &Map::new(&env),
                ) {
                    Ok(Ok(_)) => {
                        pkg_list.push((pid, recipient, amount, expires_at));
                        ops_log.push((
                            step,
                            format!("create(pkg={}, amt={})", pid, amount),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("create(pkg={}, amt={})", pid, amount),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("create(pkg={}, amt={})", pid, amount),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if action < 95 {
                // WITHDRAW_SURPLUS
                let amount = UNIT * iter_rng.gen_range(1..=5) as i128;
                let to = Address::generate(&env);
                match client.try_withdraw_surplus(&to, &amount, &token) {
                    Ok(Ok(())) => {
                        total_withdrawn += amount;
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else {
                // ADVANCE time
                let seconds = iter_rng.gen_range(60..=7200) as u64;
                advance_time(&env, seconds);
                ops_log.push((
                    step,
                    format!("advance_time({}s)", seconds),
                    true,
                    String::new(),
                ));
            }

            assert_invariants(
                &client,
                &token_client,
                &token,
                total_funded,
                total_refunded,
                total_withdrawn,
                iter as u64,
                step,
                seed,
                &ops_log,
            );
        }
    }
}

// ============================================================================
// test_full_lifecycle_invariants
// ============================================================================

#[test]
fn test_full_lifecycle_invariants() {
    const BASE_SEED: u64 = 0x1234_5678;
    let mut rng = StdRng::seed_from_u64(BASE_SEED);

    for iter in 0..100 {
        let seed = rng.gen::<u64>();
        let mut iter_rng = StdRng::seed_from_u64(seed);
        let (env, client, admin, token, token_sac, token_client) = setup_env();

        let mut total_funded: i128 = 0;
        let mut total_refunded: i128 = 0;
        let mut total_withdrawn: i128 = 0;
        let mut next_pkg_id: u64 = 0;
        let mut ops_log: Vec<(usize, String, bool, String)> = Vec::new();

        // Phase 1: Fund the contract
        let fund_amount = UNIT * iter_rng.gen_range(30..=80) as i128;
        token_sac.mint(&admin, &fund_amount);
        client.fund(&token, &admin, &fund_amount);
        total_funded += fund_amount;
        ops_log.push((0, format!("fund({})", fund_amount), true, String::new()));
        assert_invariants(
            &client,
            &token_client,
            &token,
            total_funded,
            total_refunded,
            total_withdrawn,
            iter as u64,
            0,
            seed,
            &ops_log,
        );

        // Phase 2: Create several packages (some will be claimed, some revoked, some refunded)
        let n_packages = iter_rng.gen_range(4..=10) as usize;
        let mut packages: Vec<(u64, Address, i128, u64, &str)> = Vec::new(); // (id, recipient, amount, expires_at, label)

        let labels = ["claim", "revoke", "refund", "claim", "revoke", "revoke"];

        for i in 0..n_packages {
            let amount = UNIT * iter_rng.gen_range(1..=5) as i128;
            let recipient = Address::generate(&env);
            let expires_in = iter_rng.gen_range(3600..=14400) as u64;
            let expires_at = env.ledger().timestamp() + expires_in;
            let pid = next_pkg_id;
            next_pkg_id += 1;
            let label = labels[i % labels.len()];

            match client.try_create_package(
                &admin,
                &pid,
                &recipient,
                &amount,
                &token,
                &expires_at,
                &Map::new(&env),
            ) {
                Ok(Ok(_)) => {
                    packages.push((pid, recipient, amount, expires_at, label));
                    ops_log.push((
                        i + 1,
                        format!("create(pkg={}, amt={}, label={})", pid, amount, label),
                        true,
                        String::new(),
                    ));
                }
                Ok(Err(e)) => {
                    ops_log.push((
                        i + 1,
                        format!("create(pkg={}, amt={})", pid, amount),
                        false,
                        format!("{:?}", e),
                    ));
                }
                Err(_) => {
                    ops_log.push((
                        i + 1,
                        format!("create(pkg={}, amt={})", pid, amount),
                        false,
                        "host_err".into(),
                    ));
                }
            }
            assert_invariants(
                &client,
                &token_client,
                &token,
                total_funded,
                total_refunded,
                total_withdrawn,
                iter as u64,
                (i + 1) as usize,
                seed,
                &ops_log,
            );
        }

        // Phase 3: Execute the labeled action on each package
        let base_step = n_packages + 1;

        for (i, &(pid, ref _recipient, amount, expires_at, label)) in packages.iter().enumerate() {
            let step = base_step + i;
            match label {
                "claim" => match client.try_claim(&pid) {
                    Ok(Ok(())) => {
                        ops_log.push((
                            step,
                            format!("claim(pkg={}, amt={})", pid, amount),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("claim(pkg={})", pid),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("claim(pkg={})", pid),
                            false,
                            "host_err".into(),
                        ));
                    }
                },
                "revoke" => match client.try_revoke(&pid) {
                    Ok(Ok(())) => {
                        ops_log.push((
                            step,
                            format!("revoke(pkg={}, amt={})", pid, amount),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("revoke(pkg={})", pid),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("revoke(pkg={})", pid),
                            false,
                            "host_err".into(),
                        ));
                    }
                },
                "refund" => {
                    let now = env.ledger().timestamp();
                    if expires_at > 0 && now <= expires_at {
                        advance_time(&env, expires_at - now + 1);
                    }
                    match client.try_refund(&pid) {
                        Ok(Ok(())) => {
                            total_refunded += amount;
                            ops_log.push((
                                step,
                                format!("refund(pkg={}, amt={})", pid, amount),
                                true,
                                String::new(),
                            ));
                        }
                        Ok(Err(e)) => {
                            ops_log.push((
                                step,
                                format!("refund(pkg={})", pid),
                                false,
                                format!("{:?}", e),
                            ));
                        }
                        Err(_) => {
                            ops_log.push((
                                step,
                                format!("refund(pkg={})", pid),
                                false,
                                "host_err".into(),
                            ));
                        }
                    }
                }
                _ => unreachable!(),
            }
            assert_invariants(
                &client,
                &token_client,
                &token,
                total_funded,
                total_refunded,
                total_withdrawn,
                iter as u64,
                step,
                seed,
                &ops_log,
            );
        }

        // Phase 4: Withdraw any remaining surplus
        let final_step = base_step + packages.len();
        let surplus_amount = UNIT * iter_rng.gen_range(1..=10) as i128;
        let to = Address::generate(&env);
        match client.try_withdraw_surplus(&to, &surplus_amount, &token) {
            Ok(Ok(())) => {
                total_withdrawn += surplus_amount;
                ops_log.push((
                    final_step,
                    format!("withdraw_surplus({})", surplus_amount),
                    true,
                    String::new(),
                ));
            }
            Ok(Err(e)) => {
                ops_log.push((
                    final_step,
                    format!("withdraw_surplus({})", surplus_amount),
                    false,
                    format!("{:?}", e),
                ));
            }
            Err(_) => {
                ops_log.push((
                    final_step,
                    format!("withdraw_surplus({})", surplus_amount),
                    false,
                    "host_err".into(),
                ));
            }
        }
        assert_invariants(
            &client,
            &token_client,
            &token,
            total_funded,
            total_refunded,
            total_withdrawn,
            iter as u64,
            final_step,
            seed,
            &ops_log,
        );
    }
}

// ============================================================================
// test_randomized_state_machine
// ============================================================================

#[derive(Clone, Debug)]
struct TrackedPkg {
    id: u64,
    recipient: Address,
    amount: i128,
    expires_at: u64,
}

#[test]
fn test_randomized_state_machine() {
    const BASE_SEED: u64 = 0xFEDC_BA98;
    let mut rng = StdRng::seed_from_u64(BASE_SEED);

    for iter in 0..100 {
        let seed = rng.gen::<u64>();
        let mut iter_rng = StdRng::seed_from_u64(seed);
        let (env, client, admin, token, token_sac, token_client) = setup_env();

        let mut total_funded: i128 = 0;
        let mut total_refunded: i128 = 0;
        let mut total_withdrawn: i128 = 0;
        let mut next_pkg_id: u64 = 0;
        let mut packages: Vec<TrackedPkg> = Vec::new();
        let mut ops_log: Vec<(usize, String, bool, String)> = Vec::new();

        let n_ops: usize = iter_rng.gen_range(20..=40);

        for step in 0..n_ops {
            let roll = iter_rng.gen_range(0u32..100);

            if roll < 20 {
                // FUND
                let amount = UNIT * iter_rng.gen_range(5..=30) as i128;
                token_sac.mint(&admin, &amount);
                match client.try_fund(&token, &admin, &amount) {
                    Ok(Ok(())) => {
                        total_funded += amount;
                        ops_log.push((step, format!("fund({})", amount), true, String::new()));
                    }
                    _ => {
                        ops_log.push((step, format!("fund({})", amount), false, "err".into()));
                    }
                }
            } else if roll < 45 {
                // CREATE_PACKAGE
                let amount = UNIT * iter_rng.gen_range(1..=10) as i128;
                let recipient = Address::generate(&env);
                let expires_in = iter_rng.gen_range(600..=14400) as u64;
                let expires_at = env.ledger().timestamp() + expires_in;
                let pid = next_pkg_id;
                next_pkg_id += 1;

                match client.try_create_package(
                    &admin,
                    &pid,
                    &recipient,
                    &amount,
                    &token,
                    &expires_at,
                    &Map::new(&env),
                ) {
                    Ok(Ok(_)) => {
                        packages.push(TrackedPkg {
                            id: pid,
                            recipient,
                            amount,
                            expires_at,
                        });
                        ops_log.push((
                            step,
                            format!("create(id={}, amt={})", pid, amount),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("create(id={}, amt={})", pid, amount),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    _ => {
                        ops_log.push((
                            step,
                            format!("create(id={}, amt={})", pid, amount),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if roll < 65 && !packages.is_empty() {
                // CLAIM
                let idx = iter_rng.gen_range(0..packages.len());
                let pkg = packages[idx].clone();
                match client.try_claim(&pkg.id) {
                    Ok(Ok(())) => {
                        packages.remove(idx);
                        ops_log.push((step, format!("claim(id={})", pkg.id), true, String::new()));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("claim(id={})", pkg.id),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    _ => {
                        ops_log.push((
                            step,
                            format!("claim(id={})", pkg.id),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if roll < 75 && !packages.is_empty() {
                // REVOKE
                let idx = iter_rng.gen_range(0..packages.len());
                let pkg = packages[idx].clone();
                match client.try_revoke(&pkg.id) {
                    Ok(Ok(())) => {
                        packages.remove(idx);
                        ops_log.push((step, format!("revoke(id={})", pkg.id), true, String::new()));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("revoke(id={})", pkg.id),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    _ => {
                        ops_log.push((
                            step,
                            format!("revoke(id={})", pkg.id),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if roll < 85 && !packages.is_empty() {
                // REFUND — advance time past expiry first
                let idx = iter_rng.gen_range(0..packages.len());
                let pkg = packages[idx].clone();
                let now = env.ledger().timestamp();
                if pkg.expires_at > 0 && now <= pkg.expires_at {
                    advance_time(&env, pkg.expires_at - now + 1);
                }
                match client.try_refund(&pkg.id) {
                    Ok(Ok(())) => {
                        total_refunded += pkg.amount;
                        packages.remove(idx);
                        ops_log.push((step, format!("refund(id={})", pkg.id), true, String::new()));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("refund(id={})", pkg.id),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    _ => {
                        ops_log.push((
                            step,
                            format!("refund(id={})", pkg.id),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else if roll < 92 {
                // WITHDRAW_SURPLUS
                let amount = UNIT * iter_rng.gen_range(1..=10) as i128;
                let to = Address::generate(&env);
                match client.try_withdraw_surplus(&to, &amount, &token) {
                    Ok(Ok(())) => {
                        total_withdrawn += amount;
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            true,
                            String::new(),
                        ));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    _ => {
                        ops_log.push((
                            step,
                            format!("withdraw_surplus({})", amount),
                            false,
                            "host_err".into(),
                        ));
                    }
                }
            } else {
                // ADVANCE_TIME
                let seconds = iter_rng.gen_range(60..=10800) as u64;
                advance_time(&env, seconds);
                ops_log.push((
                    step,
                    format!("advance_time({}s)", seconds),
                    true,
                    String::new(),
                ));
            }

            assert_invariants(
                &client,
                &token_client,
                &token,
                total_funded,
                total_refunded,
                total_withdrawn,
                iter as u64,
                step,
                seed,
                &ops_log,
            );
        }
    }
}
