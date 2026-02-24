# Implementation Plan: OnChain Legacy Cleanup

## Overview

This plan focuses on updating documentation files (README.md, CONTRIBUTING.md) and expanding test coverage in core_flow.rs to align with the current AidEscrow contract implementation. Each task builds incrementally, starting with documentation updates and then expanding test coverage.

## Tasks

- [x] 1. Update README.md method reference table
  - Add missing methods to the method reference table: batch_create_packages, cancel_package, extend_expiration, get_aggregates, set_config, get_admin, get_package
  - For each method, include: method signature, description, and auth requirements
  - Ensure consistent formatting with existing entries
  - Verify all public methods from lib.rs are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 5.1_

- [x] 2. Add data structure documentation to README.md
  - Document the Package struct with all fields
  - Document the Config struct with all fields
  - Document the Aggregates struct with all fields
  - Document the PackageStatus enum with all variants
  - Place documentation in appropriate section (before or after method reference)
  - _Requirements: 5.3_

- [x] 3. Update CONTRIBUTING.md code examples
  - Update the create_package example to include all current parameters: id, recipient, amount, token, expires_at
  - Verify parameter types match the implementation (e.g., id: u64, amount: i128)
  - Update error type references to match current Error enum variants
  - Ensure return type annotations are accurate
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.2_

- [x] 4. Checkpoint - Review documentation updates
  - Ensure all documentation changes are accurate and complete
  - Ask the user if questions arise

- [x] 5. Add test for batch_create_packages
  - [x] 5.1 Write integration test for batch_create_packages success path
    - Set up contract with admin and funded pool
    - Create multiple packages in a single batch call
    - Verify all packages are created with correct state
    - Verify pool balance is correctly reduced
    - _Requirements: 4.1_
  
  - [x]* 5.2 Write test for batch_create_packages error conditions
    - Test insufficient funds error when batch exceeds available balance
    - Test duplicate package ID error
    - _Requirements: 4.1, 4.6_

- [x] 6. Add test for extend_expiration
  - [x] 6.1 Write integration test for extend_expiration success path
    - Create a package with initial expiration time
    - Call extend_expiration with additional time
    - Verify package expiration is updated correctly
    - _Requirements: 4.3_
  
  - [x]* 6.2 Write test for extend_expiration error conditions
    - Test error when extending non-existent package
    - Test error when extending already claimed package
    - _Requirements: 4.3, 4.6_

- [x] 7. Add test for get_aggregates
  - [x] 7.1 Write integration test for get_aggregates
    - Fund contract with tokens
    - Create multiple packages
    - Call get_aggregates and verify total_deposited and total_locked values
    - Claim a package and verify aggregates update correctly
    - _Requirements: 4.4_

- [x] 8. Add tests for set_config and get_config
  - [x] 8.1 Write integration test for set_config and get_config
    - Initialize contract
    - Call set_config with new configuration
    - Call get_config and verify configuration is stored correctly
    - _Requirements: 4.5_
  
  - [x]* 8.2 Write test for set_config authorization
    - Test that non-admin cannot call set_config
    - _Requirements: 4.5, 4.6_

- [x] 9. Verify existing tests still pass
  - Run cargo test to ensure all existing tests pass
  - Verify test_core_flow_fund_create_claim still works
  - Verify test_solvency_check still works
  - Verify test_expiry_and_refund still works
  - Verify test_revoke_flow still works
  - Verify test_cancel_package_comprehensive still works
  - _Requirements: 4.7, 7.1, 7.3, 7.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run full test suite with cargo test
  - Ensure all documentation is accurate and complete
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster completion
- Documentation tasks (1-3) should be completed before test tasks (5-8)
- Each test task references specific requirements for traceability
- Existing tests should not be modified unless fixing actual bugs
- New tests should follow existing patterns in core_flow.rs (setup_token, mock_all_auths, etc.)
