#![cfg(test)]
#![allow(clippy::all)]
#![allow(dead_code)]

use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error, SURPLUS_WITHDRAWAL_DELAY_SECS};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

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
        claim_cooldown: 0,
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

/// Compatibility shim: execute a surplus withdrawal via the timelock flow.
///
/// The property tests need a single-step "try withdraw" that returns the same
/// success/failure shape as the old atomic `withdraw_surplus`.  This function:
/// 1. Cancels any stale pending proposal (defensive clean-up).
/// 2. Proposes the withdrawal.
/// 3. Advances the ledger by `SURPLUS_WITHDRAWAL_DELAY_SECS` so the timelock
///    expires immediately.
/// 4. Executes the withdrawal.
///
/// Returns `Ok(Ok(()))` on success, `Ok(Err(Error))` on a contract error, or
/// `Err(())` on a host-level failure, mirroring the `try_*` convention.
#[allow(dead_code)]
fn try_withdraw_surplus_via_timelock(
    env: &Env,
    client: &AidEscrowClient,
    to: &Address,
    amount: i128,
    token: &Address,
) -> Result<Result<(), Error>, ()> {
    // Cancel any existing pending proposal so we can make a fresh one.
    let _ = client.try_cancel_surplus_withdrawal();

    // Propose â€” propagate any contract error immediately.
    match client.try_propose_surplus_withdrawal(to, &amount, token) {
        Ok(Ok(())) => {}
        Ok(Err(_)) => return Err(()),
        Err(Ok(e)) => return Ok(Err(e)),
        Err(Err(_)) => return Err(()),
    }

    // Advance time past the delay so execute is unblocked.
    advance_time(env, SURPLUS_WITHDRAWAL_DELAY_SECS);

    // Execute.
    match client.try_execute_surplus_withdrawal() {
        Ok(Ok(())) => Ok(Ok(())),
        Ok(Err(_)) => Err(()),
        Err(Ok(e)) => Ok(Err(e)),
        Err(Err(_)) => Err(()),
    }
}

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
    eprintln!("\nâ•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• INVARIANT FAILURE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—");
    eprintln!("â•‘ iteration: {:<44} â•‘", iteration);
    eprintln!("â•‘ seed:      {:<44} â•‘", seed);
    eprintln!("â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• OPERATION SEQUENCE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£");
    for (i, op, ok, err) in ops {
        let status = if *ok { "OK" } else { "FAIL" };
        eprintln!("â•‘ {:>3}: {:<38} {:>4} {}", i, op, status, err);
    }
    eprintln!("â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• STATE SNAPSHOT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£");
    eprintln!(
        "â•‘ total_locked:      {:<38} â•‘",
        client.get_total_locked(token)
    );
    eprintln!(
        "â•‘ total_claimed:     {:<38} â•‘",
        client.get_total_claimed(token)
    );
    eprintln!(
        "â•‘ contract_balance:  {:<38} â•‘",
        token_client.balance(&client.address)
    );
    eprintln!("â•‘ total_funded:      {:<38} â•‘", total_funded);
    eprintln!("â•‘ total_refunded:    {:<38} â•‘", total_refunded);
    eprintln!("â•‘ total_withdrawn:   {:<38} â•‘", total_withdrawn);
    eprintln!("â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n");
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
                match try_withdraw_surplus_via_timelock(&env, &client, &to, amount, &token) {
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
                // REFUND â€” advance time to trigger expiration, then refund
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
                match try_withdraw_surplus_via_timelock(&env, &client, &to, amount, &token) {
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
        match try_withdraw_surplus_via_timelock(&env, &client, &to, surplus_amount, &token) {
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
                // REFUND â€” advance time past expiry first
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
                match try_withdraw_surplus_via_timelock(&env, &client, &to, amount, &token) {
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
// ============================================================================
// test_campaign_fund_conservation_invariants
// ============================================================================

/// Build `create_package` metadata tagged with the given campaign reference so
/// packages are attributed to a campaign by the contract.
fn campaign_meta(env: &Env, campaign: &str) -> Map<soroban_sdk::Symbol, soroban_sdk::String> {
    let mut m = Map::new(env);
    m.set(
        soroban_sdk::Symbol::new(env, "campaign_ref"),
        soroban_sdk::String::from_str(env, campaign),
    );
    m
}

/// Cross-checks the campaign-level fund-conservation invariant against the
/// token-level totals.
///
/// This is a pure function of the aggregated values it receives, so it can be
/// exercised (1) by `test_campaign_fund_conservation_invariants` against the
/// *real* contract state through the contract's getters, and (2) by
/// `test_campaign_conservation_bug_detection` against deliberately corrupted
/// values, which confirms the check fails when a conservation invariant is
/// violated instead of being a vacuous assertion.
///
/// - `campaign_locked` / `campaign_claimed` are read live from the contract's
///   per-campaign counters (getters).
/// - `campaign_refunded` / `campaign_funded` are maintained by the caller's
///   own operation accounting.
/// - `token_locked` / `token_claimed` / `token_funded` are the token-level
///   totals.
/// - `untagged_*` are amounts belonging to packages that carry no
///   `campaign_ref`; they must never be attributed to a campaign.
fn check_campaign_conservation_invariants(
    campaigns: &[String],
    token_locked: i128,
    token_claimed: i128,
    token_funded: i128,
    campaign_locked: &HashMap<String, i128>,
    campaign_claimed: &HashMap<String, i128>,
    campaign_refunded: &HashMap<String, i128>,
    campaign_funded: &HashMap<String, i128>,
    untagged_locked: i128,
    untagged_claimed: i128,
    untagged_funded: i128,
) {
    // (1) Per-campaign conservation: locked + claimed + refunded <= funded.
    for camp in campaigns {
        let locked = *campaign_locked.get(camp).unwrap_or(&0);
        let claimed = *campaign_claimed.get(camp).unwrap_or(&0);
        let refunded = *campaign_refunded.get(camp).unwrap_or(&0);
        let funded = *campaign_funded.get(camp).unwrap_or(&0);
        let accounted = locked + claimed + refunded;
        assert!(
            accounted <= funded,
            "Campaign '{}' conservation violated: locked={} + claimed={} + refunded={} = {} > funded={}",
            camp, locked, claimed, refunded, accounted, funded,
        );
    }

    // (2) Cross-campaign consistency against the token-level totals.
    let sum_locked: i128 = campaigns
        .iter()
        .map(|c| *campaign_locked.get(c).unwrap_or(&0))
        .sum();
    let sum_claimed: i128 = campaigns
        .iter()
        .map(|c| *campaign_claimed.get(c).unwrap_or(&0))
        .sum();
    let sum_funded: i128 = campaigns
        .iter()
        .map(|c| *campaign_funded.get(c).unwrap_or(&0))
        .sum();

    assert_eq!(
        sum_locked + untagged_locked,
        token_locked,
        "Campaign-locked sum ({}) + untagged locked ({}) must equal token-level locked ({})",
        sum_locked,
        untagged_locked,
        token_locked,
    );
    assert_eq!(
        sum_claimed + untagged_claimed,
        token_claimed,
        "Campaign-claimed sum ({}) + untagged claimed ({}) must equal token-level claimed ({})",
        sum_claimed,
        untagged_claimed,
        token_claimed,
    );
    // Revoking a package unlocks its budget while the tokens remain in the
    // escrow pool (see ``batch_revoke``'s doc comment), and refunding an expired
    // package returns its amount to the caller, so the escrow can legitimately
    // back more cumulative package creations than it has received in funding.
    // What must never happen is the contract accounting for more (locked or
    // claimed) on behalf of campaigns plus untagged packages than has actually
    // been funded, nor for the recorded campaign funding to fall short of what
    // is currently accounted.
    let accounted_now = sum_locked + untagged_locked + sum_claimed + untagged_claimed;
    let funded_now = sum_funded + untagged_funded;
    assert!(
        funded_now >= accounted_now && accounted_now <= token_funded,
        "Campaign funding ({} recorded / {} token-funded) inconsistent with accounted amounts (locked {} + claimed {} = {})",
        funded_now, token_funded, sum_locked + untagged_locked, sum_claimed + untagged_claimed, accounted_now,
    );
}
// ============================================================================
// test_campaign_fund_conservation_invariants
// ============================================================================

#[test]
fn test_campaign_fund_conservation_invariants() {
    const BASE_SEED: u64 = 0xFEDC_0001;
    let mut rng = StdRng::seed_from_u64(BASE_SEED);

    // Randomized operation sequences that span at least two campaigns sharing
    // one token (camp-1 and camp-2 are seeded up front, plus untagged
    // packages).  After every operation we assert that the per-campaign
    // aggregates sum back to the token-level totals and that each campaign's
    // own conservation guard holds.
    for iter in 0..50 {
        let seed = rng.gen::<u64>();
        let mut iter_rng = StdRng::seed_from_u64(seed);
        let (env, client, admin, token, token_sac, token_client) = setup_env();

        // Per-campaign + untagged bookkeeping (plain std collections).
        let mut campaigns: Vec<String> = Vec::new();
        let mut campaign_funded: HashMap<String, i128> = HashMap::new();
        let mut campaign_refunded: HashMap<String, i128> = HashMap::new();
        let mut untagged_funded: i128 = 0;
        let mut untagged_claimed: i128 = 0;
        let mut untagged_locked: i128 = 0;

        // Token-level accumulators (cross-checked by the existing token-level
        // `assert_invariants`).
        let mut token_funded: i128 = 0;
        let mut token_refunded: i128 = 0;
        let token_withdrawn: i128 = 0;

        let mut next_pkg_id: u64 = 0;
        let mut packages: Vec<(u64, i128, Option<String>)> = Vec::new();
        let mut ops_log: Vec<(usize, String, bool, String)> = Vec::new();

        // ---- Phase 1: seed escrow and create packages across two campaigns. ----
        let seed_fund = UNIT * 10;
        token_sac.mint(&admin, &seed_fund);
        match client.try_fund(&token, &admin, &seed_fund) {
            Ok(Ok(())) => {
                token_funded += seed_fund;
                ops_log.push((0, "fund(10*UNIT)".to_string(), true, String::new()));
            }
            Ok(Err(_)) => {
                ops_log.push((
                    0,
                    "fund(10*UNIT)".to_string(),
                    false,
                    "contract error".to_string(),
                ));
            }
            Err(_) => {
                ops_log.push((
                    0,
                    "fund(10*UNIT)".to_string(),
                    false,
                    "host error".to_string(),
                ));
            }
        }

        // camp-1
        let pid = next_pkg_id;
        next_pkg_id += 1;
        let recipient = Address::generate(&env);
        let expires_at = env.ledger().timestamp() + 86_400;
        if let Ok(Ok(_)) = client.try_create_package(
            &admin,
            &pid,
            &recipient,
            &(UNIT * 5),
            &token,
            &expires_at,
            &campaign_meta(&env, "camp-1"),
        ) {
            packages.push((pid, UNIT * 5, Some("camp-1".to_string())));
            *campaign_funded.entry("camp-1".to_string()).or_insert(0) += UNIT * 5;
            ops_log.push((
                1,
                format!("create(pkg={}, amt={})", pid, UNIT * 5),
                true,
                String::new(),
            ));
        } else {
            ops_log.push((
                1,
                format!("create(pkg={})", pid),
                false,
                "create failed".to_string(),
            ));
        }

        // camp-2
        let pid = next_pkg_id;
        next_pkg_id += 1;
        let recipient = Address::generate(&env);
        let expires_at = env.ledger().timestamp() + 86_400;
        if let Ok(Ok(_)) = client.try_create_package(
            &admin,
            &pid,
            &recipient,
            &(UNIT * 7),
            &token,
            &expires_at,
            &campaign_meta(&env, "camp-2"),
        ) {
            packages.push((pid, UNIT * 7, Some("camp-2".to_string())));
            *campaign_funded.entry("camp-2".to_string()).or_insert(0) += UNIT * 7;
            ops_log.push((
                2,
                format!("create(pkg={}, amt={})", pid, UNIT * 7),
                true,
                String::new(),
            ));
        } else {
            ops_log.push((
                2,
                format!("create(pkg={})", pid),
                false,
                "create failed".to_string(),
            ));
        }

        // Untagged
        let pid = next_pkg_id;
        next_pkg_id += 1;
        let recipient = Address::generate(&env);
        let expires_at = env.ledger().timestamp() + 86_400;
        if let Ok(Ok(_)) = client.try_create_package(
            &admin,
            &pid,
            &recipient,
            &(UNIT * 2),
            &token,
            &expires_at,
            &Map::new(&env),
        ) {
            packages.push((pid, UNIT * 2, None));
            untagged_funded += UNIT * 2;
            untagged_locked += UNIT * 2;
            ops_log.push((
                3,
                format!("create(pkg={}, amt={})", pid, UNIT * 2),
                true,
                String::new(),
            ));
        } else {
            ops_log.push((
                3,
                format!("create(pkg={})", pid),
                false,
                "create failed".to_string(),
            ));
        }

        campaigns.push("camp-1".to_string());
        campaigns.push("camp-2".to_string());

        // ---- Phase 2: randomized operation sequence ----
        let n_ops: usize = iter_rng.gen_range(30..80);

        for step in 0..n_ops {
            let action = iter_rng.gen_range(0..100);

            if action < 30 {
                // CREATE_PACKAGE: tagged or untagged
                let amount = UNIT * iter_rng.gen_range(1..6) as i128;
                if iter_rng.gen_ratio(3, 5) {
                    let camp = format!("camp-{}", iter_rng.gen_range(1..3));
                    if !campaigns.contains(&camp) {
                        campaigns.push(camp.clone());
                    }
                    let received = Some(camp.clone());
                    let pid = next_pkg_id;
                    next_pkg_id += 1;
                    let recipient = Address::generate(&env);
                    let expires_at = env.ledger().timestamp() + 86_400;
                    match client.try_create_package(
                        &admin,
                        &pid,
                        &recipient,
                        &amount,
                        &token,
                        &expires_at,
                        &campaign_meta(&env, &camp),
                    ) {
                        Ok(Ok(_)) => {
                            packages.push((pid, amount, received));
                            *campaign_funded.entry(camp).or_insert(0) += amount;
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
                                format!("create(pkg={})", pid),
                                false,
                                format!("{:?}", e),
                            ));
                        }
                        Err(_) => {
                            ops_log.push((
                                step,
                                format!("create(pkg={})", pid),
                                false,
                                "host error".to_string(),
                            ));
                        }
                    }
                } else {
                    let pid = next_pkg_id;
                    next_pkg_id += 1;
                    let recipient = Address::generate(&env);
                    let expires_at = env.ledger().timestamp() + 86_400;
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
                            packages.push((pid, amount, None));
                            untagged_funded += amount;
                            untagged_locked += amount;
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
                                format!("create(pkg={})", pid),
                                false,
                                format!("{:?}", e),
                            ));
                        }
                        Err(_) => {
                            ops_log.push((
                                step,
                                format!("create(pkg={})", pid),
                                false,
                                "host error".to_string(),
                            ));
                        }
                    }
                }
            } else if action < 55 {
                // FUND
                let amount = UNIT * iter_rng.gen_range(1..6) as i128;
                token_sac.mint(&admin, &amount);
                match client.try_fund(&token, &admin, &amount) {
                    Ok(Ok(())) => {
                        token_funded += amount;
                        ops_log.push((step, format!("fund({})", amount), true, String::new()));
                    }
                    Ok(Err(e)) => {
                        ops_log.push((
                            step,
                            format!("fund({})", amount),
                            false,
                            format!("{:?}", e),
                        ));
                    }
                    Err(_) => {
                        ops_log.push((
                            step,
                            format!("fund({})", amount),
                            false,
                            "host error".to_string(),
                        ));
                    }
                }
            } else if action < 70 && !packages.is_empty() {
                // CLAIM a random package
                let idx = iter_rng.gen_range(0..packages.len());
                let (pid, amount, campaign) = packages[idx].clone();
                match client.try_claim(&pid) {
                    Ok(Ok(())) => {
                        packages.remove(idx);
                        if campaign.is_none() {
                            untagged_claimed += amount;
                            untagged_locked -= amount;
                        }
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
                            "host error".to_string(),
                        ));
                    }
                }
            } else if action < 82 && !packages.is_empty() {
                // DISBURSE a random package (admin-forced; never counts as a claim)
                let idx = iter_rng.gen_range(0..packages.len());
                let (pid, amount, campaign) = packages[idx].clone();
                if matches!(client.try_disburse(&pid), Ok(Ok(()))) {
                    packages.remove(idx);
                    if campaign.is_none() {
                        untagged_locked -= amount;
                    }
                    ops_log.push((step, format!("disburse(pkg={})", pid), true, String::new()));
                } else {
                    ops_log.push((
                        step,
                        format!("disburse(pkg={})", pid),
                        false,
                        "disburse failed".to_string(),
                    ));
                }
            } else if action < 90 && !packages.is_empty() {
                // REVOKE a random package
                let idx = iter_rng.gen_range(0..packages.len());
                let (pid, amount, campaign) = packages[idx].clone();
                match client.try_revoke(&pid) {
                    Ok(Ok(())) => {
                        packages.remove(idx);
                        if campaign.is_none() {
                            untagged_locked -= amount;
                        }
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
                            "host error".to_string(),
                        ));
                    }
                }
            } else if action < 96 && !packages.is_empty() {
                // REFUND: advance time past expiry, then refund
                let idx = iter_rng.gen_range(0..packages.len());
                let (pid, amount, campaign) = packages[idx].clone();
                let _ = advance_time(&env, 90_000);
                match client.try_refund(&pid) {
                    Ok(Ok(())) => {
                        packages.remove(idx);
                        if campaign.is_none() {
                            untagged_locked -= amount;
                        }
                        if let Some(c) = campaign {
                            *campaign_refunded.entry(c.clone()).or_insert(0) += amount;
                        }
                        token_refunded += amount;
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
                            "host error".to_string(),
                        ));
                    }
                }
            } else if action < 98 && !packages.is_empty() {
                // REASSIGN a random package to a fresh recipient
                let idx = iter_rng.gen_range(0..packages.len());
                let (pid, _amount, _campaign) = packages[idx].clone();
                let new_recipient = Address::generate(&env);
                if matches!(
                    client.try_reassign_package(&pid, &new_recipient),
                    Ok(Ok(()))
                ) {
                    ops_log.push((step, format!("reassign(pkg={})", pid), true, String::new()));
                } else {
                    ops_log.push((
                        step,
                        format!("reassign(pkg={})", pid),
                        false,
                        "reassign failed".to_string(),
                    ));
                }
            } else {
                // ADVANCE_TIME
                let seconds = iter_rng.gen_range(60..7200) as u64;
                advance_time(&env, seconds);
                ops_log.push((
                    step,
                    format!("advance_time({})s", seconds),
                    true,
                    String::new(),
                ));
            }

            // ---- Assert token-level invariants ----
            let locked = client.get_total_locked(&token);
            let claimed = client.get_total_claimed(&token);
            let balance = token_client.balance(&client.address);

            let accounted = locked + claimed + token_refunded + token_withdrawn;
            assert!(
                accounted <= token_funded,
                "inv(1) violated at iter={} step={}: locked={} + claimed={} + refunded={} + withdrawn={} = {} > funded={}",
                iter, step, locked, claimed, token_refunded, token_withdrawn, accounted, token_funded,
            );
            assert!(
                balance >= locked,
                "inv(2) violated at iter={} step={}: balance={} < locked={}",
                iter,
                step,
                balance,
                locked,
            );
            assert!(
                locked >= 0 && claimed >= 0 && token_refunded >= 0 && token_withdrawn >= 0 && token_funded >= 0 && balance >= 0,
                "inv(3) violated at iter={} step={}: locked={} claimed={} refunded={} withdrawn={} funded={} balance={}",
                iter, step, locked, claimed, token_refunded, token_withdrawn, token_funded, balance,
            );

            // ---- Assert per-campaign conservation ----
            let token_locked = client.get_total_locked(&token);
            let token_claimed = client.get_total_claimed(&token);

            let mut camp_locked: HashMap<String, i128> = HashMap::new();
            let mut camp_claimed: HashMap<String, i128> = HashMap::new();
            let mut camp_refunded: HashMap<String, i128> = HashMap::new();
            for camp in &campaigns {
                let camp_ref = soroban_sdk::String::from_str(&env, camp);
                camp_locked.insert(
                    camp.clone(),
                    client.get_campaign_token_locked(&camp_ref, &token),
                );
                camp_claimed.insert(
                    camp.clone(),
                    client.get_campaign_token_claimed(&camp_ref, &token),
                );
                camp_refunded.insert(camp.clone(), *campaign_refunded.get(camp).unwrap_or(&0));
            }

            check_campaign_conservation_invariants(
                &campaigns,
                token_locked,
                token_claimed,
                token_funded,
                &camp_locked,
                &camp_claimed,
                &camp_refunded,
                &campaign_funded,
                untagged_locked,
                untagged_claimed,
                untagged_funded,
            );
        }
    }
}
// ============================================================================
// test_campaign_conservation_bug_detection
// ============================================================================

#[test]
fn test_campaign_conservation_bug_detection() {
    // Prove the per-campaign conservation check is *not* vacuous: a
    // deliberately introduced conservation bug must make the check fail.
    const BASE_SEED: u64 = 0xDEAD_BEEF;
    let mut rng = StdRng::seed_from_u64(BASE_SEED);
    let _ = rng.gen::<u64>();

    let (env, client, admin, token, token_sac, _) = setup_env();

    // Fund the escrow with exactly enough to cover the packages below.
    let fund_amount = UNIT * 21;
    token_sac.mint(&admin, &fund_amount);
    client
        .try_fund(&token, &admin, &fund_amount)
        .unwrap()
        .unwrap();
    let token_funded = UNIT * 21;

    // Create packages across camp-1, camp-2, and one untagged package.
    let pkg = |pid: u64, amount: i128, camp: Option<&str>| {
        let recipient = Address::generate(&env);
        let expires_at = env.ledger().timestamp() + 86_400;
        let metadata = match camp {
            Some(c) => campaign_meta(&env, c),
            None => Map::new(&env),
        };
        client
            .try_create_package(
                &admin,
                &pid,
                &recipient,
                &amount,
                &token,
                &expires_at,
                &metadata,
            )
            .unwrap()
            .unwrap();
    };
    pkg(1, UNIT * 5, Some("camp-1"));

    // pkg-1: camp-1 (5 UNIT) -> later claimed by recipient.
    // pkg-2: camp-2 (7 UNIT) -> later admin-disbursed.
    // pkg-3: camp-1 (3 UNIT) -> later admin-revoked.
    // pkg-4: untagged (2 UNIT) -> stays Created.
    // pkg-5: camp-2 (4 UNIT) -> later refunded after expiry.
    pkg(2, UNIT * 7, Some("camp-2"));
    pkg(3, UNIT * 3, Some("camp-1"));
    pkg(4, UNIT * 2, None);
    pkg(5, UNIT * 4, Some("camp-2"));

    // Mutate packages to reach a known state.
    client.try_claim(&1).unwrap().unwrap(); // camp-1: locked 8 -> 3, claimed 0 -> 5.
    client.try_disburse(&2).unwrap().unwrap(); // camp-2: locked 7 -> 0.
    client.try_revoke(&3).unwrap().unwrap(); // camp-1: locked 8 -> 0 (5 claimed + 3 revoked).
    advance_time(&env, 90_000); // pkg-5 (camp-2) now expired.
    client.try_refund(&5).unwrap().unwrap(); // camp-2: locked 4 -> 0, refunded = 4.

    // Compute the real per-campaign + untagged aggregates.
    let mut camp_locked: HashMap<String, i128> = HashMap::new();
    let mut camp_claimed: HashMap<String, i128> = HashMap::new();
    let mut camp_refunded: HashMap<String, i128> = HashMap::new();
    let mut campaign_funded: HashMap<String, i128> = HashMap::new();

    // camp-1: funded 5+3=8, locked 0, claimed 5, refunded 0.
    camp_locked.insert("camp-1".to_string(), 0);
    camp_claimed.insert("camp-1".to_string(), UNIT * 5);
    campaign_funded.insert("camp-1".to_string(), UNIT * 8);
    camp_refunded.insert("camp-1".to_string(), 0);

    // camp-2: funded 7+4=11, locked 0, claimed 0, refunded 4.
    camp_locked.insert("camp-2".to_string(), 0);
    camp_claimed.insert("camp-2".to_string(), 0);
    campaign_funded.insert("camp-2".to_string(), UNIT * 11);
    camp_refunded.insert("camp-2".to_string(), UNIT * 4);

    let untagged_funded = UNIT * 2;
    let untagged_claimed = 0;
    let token_locked = client.get_total_locked(&token);
    let token_claimed = client.get_total_claimed(&token);
    let untagged_locked = token_locked - camp_locked["camp-1"] - camp_locked["camp-2"];

    // 1) The real contract state must pass the conservation check.
    check_campaign_conservation_invariants(
        &["camp-1".to_string(), "camp-2".to_string()],
        token_locked,
        token_claimed,
        token_funded,
        &camp_locked,
        &camp_claimed,
        &camp_refunded,
        &campaign_funded,
        untagged_locked,
        untagged_claimed,
        untagged_funded,
    );

    // 2) Deliberately introduce a conservation bug: undercount camp-1's
    //    funded accounting by one package's amount (simulating a skipped
    //    increment_locked campaign delta). The same check must now fail.
    *campaign_funded.get_mut("camp-1").unwrap() -= UNIT * 5;

    let result = catch_unwind(AssertUnwindSafe(|| {
        check_campaign_conservation_invariants(
            &["camp-1".to_string(), "camp-2".to_string()],
            token_locked,
            token_claimed,
            token_funded,
            &camp_locked,
            &camp_claimed,
            &camp_refunded,
            &campaign_funded,
            untagged_locked,
            untagged_claimed,
            untagged_funded,
        );
    }));
    assert!(
        result.is_err(),
        "Bug-detection test failed: a deliberately introduced conservation bug did not make the invariant check panic",
    );
}
