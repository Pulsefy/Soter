#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{Env, Address};

#[test]
fn test_integration_flow() {
    let env = Env::default();
    
    // Setup
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    
    // 1. Initialize contract
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);
    
    // 2. Create package (admin auth required)
    env.mock_all_auths();
    let package_id = client.create_package(&recipient, &1000, &token, &86400).unwrap();
    assert_eq!(package_id, 0);
    
    // 3. Verify package details
    // get_package returns: (recipient, amount, token, status, created_at, expires_at)
    let package = client.get_package(&package_id).unwrap().unwrap();
    assert_eq!(package.0, recipient);  // recipient
    assert_eq!(package.1, 1000);       // amount
    assert_eq!(package.2, token);      // token
    assert_eq!(package.3, PackageStatus::Created as u32); // status
    
    // 4. Claim package (recipient auth required)
    env.mock_all_auths();
    client.claim_package(&package_id).unwrap();
    
    // 5. Verify claimed
    let package = client.get_package(&package_id).unwrap().unwrap();
    assert_eq!(package.3, PackageStatus::Claimed as u32); // status
    
    // 6. Verify count
    assert_eq!(client.get_package_count(), 1);
}

#[test]
fn test_multiple_packages() {
    let env = Env::default();
    
    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token = Address::generate(&env);
    
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    env.mock_all_auths();
    
    // Create multiple packages
    let id1 = client.create_package(&recipient1, &500, &token, &3600).unwrap();
    let id2 = client.create_package(&recipient2, &1000, &token, &7200).unwrap();
    
    assert_eq!(id1, 0);
    assert_eq!(id2, 1);
    assert_eq!(client.get_package_count(), 2);
    
    // Verify each package is independent
    // get_package returns: (recipient, amount, token, status, created_at, expires_at)
    let p1 = client.get_package(&id1).unwrap().unwrap();
    let p2 = client.get_package(&id2).unwrap().unwrap();
    
    assert_eq!(p1.0, recipient1);  // recipient
    assert_eq!(p2.0, recipient2);  // recipient
    assert_eq!(p1.1, 500);         // amount
    assert_eq!(p2.1, 1000);        // amount
}

#[test]
fn test_error_cases() {
    let env = Env::default();
    
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    env.mock_all_auths();
    
    // Test invalid amount
    let result = client.create_package(&recipient, &0, &token, &86400);
    assert_eq!(result, Err(Error::InvalidAmount));
    
    // Create valid package first
    let package_id = client.create_package(&recipient, &1000, &token, &86400).unwrap();
    
    // Try to claim non-existent package - should return error
    let result = client.claim_package(&999);
    assert_eq!(result, Err(Error::PackageNotFound));
    
    // Get non-existent package - should return None (not an error)
    let result = client.get_package(&999);
    assert_eq!(result, Ok(None));
}