# Requirements Document

## Introduction

This feature addresses documentation and test inconsistencies in the onchain module's AidEscrow contract. The current implementation has evolved to include newer methods (batch_create_packages, cancel_package, extend_expiration, get_aggregates) that are not documented in README.md, and the test suite only covers the legacy API subset. Additionally, CONTRIBUTING.md contains example code with outdated method signatures. This cleanup ensures all documentation accurately reflects the current implementation and establishes a single coherent contract model.

## Glossary

- **AidEscrow**: The Soroban smart contract that manages aid package escrow using a pool-based model
- **Pool_Model**: The architecture where the contract holds a global token balance and packages lock portions of that balance
- **Package**: A locked allocation of funds from the pool designated for a specific recipient
- **Legacy_API**: The original subset of methods (init, fund, create_package, claim, disburse, revoke, refund)
- **Current_API**: The complete set of methods including newer additions (batch_create_packages, cancel_package, extend_expiration, get_aggregates)
- **Method_Reference_Table**: The documentation table in README.md listing all available contract methods
- **Core_Flow_Tests**: The test suite in app/onchain/contracts/aid_escrow/tests/core_flow.rs

## Requirements

### Requirement 1: Update README Method Reference

**User Story:** As a developer integrating with AidEscrow, I want complete and accurate method documentation, so that I can discover and use all available contract functionality.

#### Acceptance Criteria

1. WHEN the Method_Reference_Table is viewed, THE Documentation SHALL include all methods from Current_API
2. THE Method_Reference_Table SHALL include batch_create_packages with description and auth requirements
3. THE Method_Reference_Table SHALL include cancel_package with description and auth requirements
4. THE Method_Reference_Table SHALL include extend_expiration with description and auth requirements
5. THE Method_Reference_Table SHALL include get_aggregates with description and auth requirements
6. THE Method_Reference_Table SHALL include set_config with description and auth requirements
7. THE Method_Reference_Table SHALL include get_admin with description and auth requirements
8. THE Method_Reference_Table SHALL include get_package with description and auth requirements

### Requirement 2: Align README with Pool Model

**User Story:** As a developer reading the documentation, I want consistent terminology and model descriptions, so that I understand the contract architecture without confusion.

#### Acceptance Criteria

1. THE README SHALL describe the Pool_Model as the current and only architecture
2. THE README SHALL NOT reference any deprecated or alternative models
3. WHEN describing invariants, THE README SHALL use terminology consistent with Pool_Model
4. WHEN describing methods, THE README SHALL explain their behavior in terms of Pool_Model

### Requirement 3: Update CONTRIBUTING Examples

**User Story:** As a contributor writing new contract code, I want accurate code examples, so that I follow current patterns and signatures.

#### Acceptance Criteria

1. WHEN the CONTRIBUTING documentation shows a method signature example, THE signature SHALL match the current implementation
2. THE create_package example SHALL include all current parameters (id, recipient, amount, token, expires_at)
3. THE documentation example SHALL use correct parameter types matching the implementation
4. THE documentation example SHALL include accurate error types from the current Error enum

### Requirement 4: Expand Test Coverage

**User Story:** As a developer maintaining the contract, I want comprehensive test coverage, so that I can verify all functionality works correctly.

#### Acceptance Criteria

1. THE Core_Flow_Tests SHALL include tests for batch_create_packages
2. THE Core_Flow_Tests SHALL include tests for cancel_package beyond the existing basic test
3. THE Core_Flow_Tests SHALL include tests for extend_expiration
4. THE Core_Flow_Tests SHALL include tests for get_aggregates
5. THE Core_Flow_Tests SHALL include tests for set_config and get_config
6. WHEN a new method is tested, THE test SHALL verify both success and error conditions
7. THE Core_Flow_Tests SHALL maintain existing tests for Legacy_API methods

### Requirement 5: Verify Documentation Completeness

**User Story:** As a project maintainer, I want to ensure no documentation gaps exist, so that developers have complete information about the contract.

#### Acceptance Criteria

1. WHEN comparing README to implementation, THE README SHALL document every public method
2. WHEN comparing CONTRIBUTING to implementation, THE CONTRIBUTING SHALL NOT contain outdated examples
3. THE documentation SHALL include descriptions of all data structures (Package, Config, Aggregates, PackageStatus)
4. THE documentation SHALL explain the relationship between fund, create_package, and the pool balance

### Requirement 6: Remove Ambiguous Legacy References

**User Story:** As a developer new to the codebase, I want clear documentation without confusing legacy references, so that I understand what is current versus deprecated.

#### Acceptance Criteria

1. THE README SHALL NOT use phrases like "legacy" or "deprecated" unless explicitly marking removed functionality
2. WHEN describing the contract model, THE README SHALL present Pool_Model as the definitive approach
3. THE documentation SHALL NOT suggest alternative architectures or models exist
4. IF any methods are truly deprecated, THE documentation SHALL explicitly mark them as deprecated with migration guidance

### Requirement 7: Ensure Test-Implementation Alignment

**User Story:** As a developer running tests, I want tests that validate the actual implementation, so that I can trust test results reflect real contract behavior.

#### Acceptance Criteria

1. WHEN Core_Flow_Tests call contract methods, THE method signatures SHALL match the current implementation
2. THE tests SHALL use current parameter names and types
3. THE tests SHALL verify current error conditions defined in the Error enum
4. THE tests SHALL NOT test removed or non-existent functionality
