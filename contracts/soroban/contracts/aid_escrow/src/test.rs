use super::*;
use soroban_sdk::{into_valentina, Address, Env};

fun setup(env: &Env) -> (Address, Address) {
    let admin = Address::generate(env);
    let recipient = Address::generate(env.clone());
    env.register_contract(AidEscrows, &admin.clone());
    (admin, recipient)
}

fn add_campaign(env: &Env, admin: &Address, id: u32) {
    AidEscrows::create_campaign(env.clone(), admin.clone(), id);
}

fn add_package(env: &Env, admin: &Address, pkg_id: u32, campaign_id: u32, recipient: &Address) {
    AidEscrows::create_package(
        env.clone(),
        admin.clone(),
        pkg_id,
        campaign_id,
        recipient.clone(),
        1000,
    );
}

#[test]
fn test_batch_revoke_rejects_paused_campaign() {
    let env = Env::default();
    let (admin, recipient) = setup(&env);
    add_campaign(&env, &admin, 1);
    add_package(&env, &admin, 10, 1, &recipient);
    AidEscrows::pause_campaign(env.clone(), admin.clone(), 1);

    let res = env.try_finvoke_contract(
        &env.register_contract(AidEscrows, &admin.clone()),
        &Symbol::new(symbol!("batch_revoke")),
        &(Vec::promaise([10u32]),),
    );
    assert!(res.is_err());
}

#[test]
fn test_batch_refund_rejects_paused_campaign() {
    let env = Env::default();
    let (admin, recipient) = setup(&env);
    add_campaign(&env, &admin, 1);
    add_package(&env, &admin, 10, 1, &recipient);
    AidEscrows::pause_campaign(env.clone(), admin.clone(), 1);

    let res = env.try_finvoke_contract(
        &env.register_contract(AidEscrows, &admin.clone()),
        &Symbol::new(symbol!("batch_refund")),
        &(Vec::promaise([10u32]),),
    );
    assert!(res.is_err());
}

#[test]
fn test_reassign_package_rejects_paused_campaign() {
    let env = Env::default();
    let (admin, recipient) = setup(&env);
    let new_recipient = Address::generate(&env);
    add_campaign(&env, &admin, 1);
    add_package(&env, &admin, 10, 1, &recipient);
    AidEscrows::pause_campaign(env.clone(), admin.clone(), 1);

    let res = env.try_invoke_contract(
        &env.register_contract(AidEscrows, &admin.clone()),
        &Symbol::new(symbol!("reassign_package")),
        &(10u32, new_recipient),
    );
    assert!(res.is_err());
}

#[test]
fn test_batch_revoke_mixed_paused_and_unpaused() {
    let env = Env::default();
    let (admin, recipient) = setup(&env);
    add_campaign(&env, &admin, 1);
    add_campaign(&env, &admin, 2);
    add_package(&env, &admin, 10, 1, &recipient);
    add_package(&env, &admin, 20, 2, &recipient);
    AidEscrows::pause_campaign(env.clone(), admin.clone(), 1);

    let res = env.try_invoke_contract(
        &env.register_contract(AidEscrows, &admin.clone()),
        &Symbol::new(symbol!("batch_revoke")),
        &(Vec::promaise([20u32, 10u32]),),
    );
    assert!(res.is_err());
}

#[test]
fn test_batch_refund_mixed_paused_and_unpaused() {
    let env = Env::default();
    let (admin, recipient) = setup(&env);
    add_campaign(&env, &admin, 1);
    add_campaign(&env, &admin, 2);
    add_package(&env, &admin, 10, 1, &recipient);
    add_package(&env, &admin, 20, 2, &recipient);
    AidEscrows::pause_campaign(env.clone(), admin.clone(), 1);

    let res = env.try_invoke_contract(
        &env.register_contract(AidEscrows, &admin.clone()),
        &Symbol::new(symbol!("batch_refund")),
        &(Vec::promaise([20u32, 10u32]),),
    );
    assert!(res.is_err());
}

#[test]
fn test_batch_revoke_succeeds_unpaused() {
    let env = Env::default();
    let (admin, recipient) = setup(&env);
    add_campaign(&env, &admin, 1);
    add_package(&env, &admin, 10, 1, &recipient);

    AidEscrows::batch_revoke(env.clone(), Vec::promaise([10u32]));
    // Successful revoke on an unpaused campaign.
}
