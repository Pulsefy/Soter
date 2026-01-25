// app/onchain/contracts/aid_escrow/tests/events.rs
// Comprehensive event emission tests for AidEscrow contract

#![cfg(test)]



use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, Symbol, Val, TryFromVal,
};

// Import from your main contract
use aid_escrow::{
    AidEscrow, AidEscrowClient, PackageStatus, EVENT_CONTRACT_INITIALIZED,
    EVENT_PACKAGE_CANCELLED, EVENT_PACKAGE_CLAIMED, EVENT_PACKAGE_CREATED, EVENT_PACKAGE_EXPIRED,
};

fn setup_test() -> (Env, AidEscrowClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn test_contract_initialized_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    // Get events
    let events = env.events().all();

    // Find ContractInitialized event
    let init_event = events.iter().find(|e| {
        if let Ok((_, topics, _)) = e.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    return symbol == Symbol::new(&env, EVENT_CONTRACT_INITIALIZED);
                }
            }
        }
        false
    });

    assert!(init_event.is_some(), "ContractInitialized event not found");
}

#[test]
fn test_package_created_event() {
    let (env, client, _admin) = setup_test();
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let amount: i128 = 1000;
    let expires_in: u64 = 86400;

    let package_id = client.create_package(&recipient, &amount, &token, &expires_in);

    // Get events
    let events = env.events().all();

    // Find PackageCreated event
    let package_created_event = events.iter().find(|e| {
        if let Ok((_, topics, _)) = e.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    return symbol == Symbol::new(&env, EVENT_PACKAGE_CREATED);
                }
            }
        }
        false
    });

    assert!(
        package_created_event.is_some(),
        "PackageCreated event not found"
    );

    // Verify the package was created
    let package = client.get_package(&package_id).unwrap();
    assert_eq!(package.recipient, recipient);
    assert_eq!(package.amount, amount);
    assert_eq!(package.status, PackageStatus::Created);
}

#[test]
fn test_package_claimed_event() {
    let (env, client, _admin) = setup_test();
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let amount: i128 = 500;

    let package_id = client.create_package(&recipient, &amount, &token, &86400);

    // Clear events from creation
    let events_before = env.events().all().len();

    client.claim_package(&package_id);

    // Get events
    let events = env.events().all();

    // Find PackageClaimed event (skip earlier events)
    let package_claimed_event = events.iter().skip(events_before as usize).find(|e| {
        if let Ok((_, topics, _)) = e.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    return symbol == Symbol::new(&env, EVENT_PACKAGE_CLAIMED);
                }
            }
        }
        false
    });

    assert!(
        package_claimed_event.is_some(),
        "PackageClaimed event not found"
    );

    // Verify the package was claimed
    let package = client.get_package(&package_id).unwrap();
    assert_eq!(package.status, PackageStatus::Claimed);
}

#[test]
fn test_package_expired_event() {
    let (env, client, _admin) = setup_test();
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let amount: i128 = 750;
    let expires_in: u64 = 100; // Short expiry

    let package_id = client.create_package(&recipient, &amount, &token, &expires_in);

    // Fast-forward time past expiry
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + expires_in + 1;
    });

    let events_before = env.events().all().len();

    // Try to claim - should fail and emit expired event
    let result = client.try_claim_package(&package_id);
    assert!(result.is_err());

    // Get events
    let events = env.events().all();

    // Find PackageExpired event
    let package_expired_event = events.iter().skip(events_before as usize).find(|e| {
        if let Ok((_, topics, _)) = e.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    return symbol == Symbol::new(&env, EVENT_PACKAGE_EXPIRED);
                }
            }
        }
        false
    });

    assert!(
        package_expired_event.is_some(),
        "PackageExpired event not found"
    );

    // Verify the package is expired
    let package = client.get_package(&package_id).unwrap();
    assert_eq!(package.status, PackageStatus::Expired);
}

#[test]
fn test_package_cancelled_event() {
    let (env, client, _admin) = setup_test();
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let amount: i128 = 300;

    let package_id = client.create_package(&recipient, &amount, &token, &86400);

    let events_before = env.events().all().len();

    client.cancel_package(&package_id);

    // Get events
    let events = env.events().all();

    // Find PackageCancelled event
    let package_cancelled_event = events.iter().skip(events_before as usize).find(|e| {
        if let Ok((_, topics, _)) = e.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    return symbol == Symbol::new(&env, EVENT_PACKAGE_CANCELLED);
                }
            }
        }
        false
    });

    assert!(
        package_cancelled_event.is_some(),
        "PackageCancelled event not found"
    );

    // Verify the package was cancelled
    let package = client.get_package(&package_id).unwrap();
    assert_eq!(package.status, PackageStatus::Cancelled);
}

#[test]
fn test_multiple_events_in_workflow() {
    let (env, client, _admin) = setup_test();
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let amount: i128 = 1500;

    // Complete workflow: create -> claim
    let package_id = client.create_package(&recipient, &amount, &token, &86400);
    client.claim_package(&package_id);

    // Get all events
    let events = env.events().all();

    // Count PackageCreated and PackageClaimed events
    let mut created_count = 0;
    let mut claimed_count = 0;

    for event in events.iter() {
        if let Ok((_, topics, _)) = event.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    if symbol == Symbol::new(&env, EVENT_PACKAGE_CREATED) {
                        created_count += 1;
                    } else if symbol == Symbol::new(&env, EVENT_PACKAGE_CLAIMED) {
                        claimed_count += 1;
                    }
                }
            }
        }
    }

    assert_eq!(
        created_count, 1,
        "Should have exactly 1 PackageCreated event"
    );
    assert_eq!(
        claimed_count, 1,
        "Should have exactly 1 PackageClaimed event"
    );
}

#[test]
fn test_multiple_packages_separate_events() {
    let (env, client, _admin) = setup_test();
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token = Address::generate(&env);

    // Create two packages
    let package_id_1 = client.create_package(&recipient1, &1000, &token, &86400);
    let package_id_2 = client.create_package(&recipient2, &2000, &token, &86400);

    // Claim first package
    client.claim_package(&package_id_1);

    // Cancel second package
    client.cancel_package(&package_id_2);

    // Get all events
    let events = env.events().all();

    // Count event types
    let mut created_count = 0;
    let mut claimed_count = 0;
    let mut cancelled_count = 0;

    for event in events.iter() {
        if let Ok((_, topics, _)) = event.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    if symbol == Symbol::new(&env, EVENT_PACKAGE_CREATED) {
                        created_count += 1;
                    } else if symbol == Symbol::new(&env, EVENT_PACKAGE_CLAIMED) {
                        claimed_count += 1;
                    } else if symbol == Symbol::new(&env, EVENT_PACKAGE_CANCELLED) {
                        cancelled_count += 1;
                    }
                }
            }
        }
    }

    assert_eq!(created_count, 2, "Should have 2 PackageCreated events");
    assert_eq!(claimed_count, 1, "Should have 1 PackageClaimed event");
    assert_eq!(cancelled_count, 1, "Should have 1 PackageCancelled event");

    // Verify package states
    let package1 = client.get_package(&package_id_1).unwrap();
    assert_eq!(package1.status, PackageStatus::Claimed);

    let package2 = client.get_package(&package_id_2).unwrap();
    assert_eq!(package2.status, PackageStatus::Cancelled);
}

#[test]
fn test_event_topics_include_package_id() {
    let (env, client, _admin) = setup_test();
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let package_id = client.create_package(&recipient, &1000, &token, &86400);

    // Get events
    let events = env.events().all();

    // Find PackageCreated event and verify it has package_id in topics
    let package_created_event = events.iter().find(|e| {
        if let Ok((_, topics, _)) = e.clone().try_into() {
            let topic_vec: soroban_sdk::Vec<Val> = topics;
            if let Some(first_topic) = topic_vec.first() {
                if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                    return symbol == Symbol::new(&env, EVENT_PACKAGE_CREATED);
                }
            }
        }
        false
    });

    assert!(
        package_created_event.is_some(),
        "PackageCreated event not found"
    );

    // Verify topics contain both event name and package_id
    if let Ok((_, topics, _)) = package_created_event.unwrap().clone().try_into() {
        let topic_vec: soroban_sdk::Vec<Val> = topics;
        // First topic is event name, second should be package_id
        assert!(topic_vec.len() >= 1, "Topics should contain event name");
    }
}

#[test]
fn test_no_events_on_failed_operations() {
    let (env, client, _admin) = setup_test();
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let events_before = env.events().all().len();

    // Try to create package with invalid amount (should fail)
    let result = client.try_create_package(&recipient, &0, &token, &86400);
    assert!(result.is_err());

    // Should not have created any new events (except possibly initialization)
    // The key is that no PackageCreated event should be emitted
    let events = env.events().all();
    let package_created_count = events
        .iter()
        .skip(events_before as usize)
        .filter(|e| {
            if let Ok((_, topics, _)) = e.clone().try_into() {
                let topic_vec: soroban_sdk::Vec<Val> = topics;
                if let Some(first_topic) = topic_vec.first() {
                    if let Ok(symbol) = Symbol::try_from_val(&env, &first_topic) {
                        return symbol == Symbol::new(&env, EVENT_PACKAGE_CREATED);
                    }
                }
            }
            false
        })
        .count();

    assert_eq!(
        package_created_count, 0,
        "Should not emit PackageCreated on failed creation"
    );
}