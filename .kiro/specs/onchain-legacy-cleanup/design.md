# Design Document: OnChain Legacy Cleanup

## Overview

This feature addresses documentation and test inconsistencies in the AidEscrow contract by updating README.md, CONTRIBUTING.md, and core_flow.rs to accurately reflect the current implementation. The cleanup ensures developers have complete, accurate information about all available methods and that tests comprehensively validate contract functionality.

The approach is primarily documentation-focused with test expansion. We will:
1. Parse the current contract implementation to extract all public methods and their signatures
2. Update README.md to include complete method documentation
3. Update CONTRIBUTING.md examples to match current signatures
4. Expand core_flow.rs to test all methods including newer additions
5. Validate consistency between documentation and implementation

## Architecture

This is a documentation and test maintenance feature with no runtime architecture changes. The work involves:

### Documentation Layer
- **README.md**: Primary user-facing documentation with method reference table
- **CONTRIBUTING.md**: Developer guidelines with code examples

### Test Layer
- **core_flow.rs**: Integration tests validating contract behavior

### Validation Layer
- Scripts or manual checks to verify documentation-implementation alignment

## Components and Interfaces

### Component 1: README Method Reference Updater

**Purpose**: Ensure README.md documents all public methods from the current implementation.

**Inputs**:
- Current README.md content
- List of public methods from lib.rs (extracted via parsing or manual review)

**Outputs**:
- Updated README.md with complete method reference table

**Behavior**:
- Parse lib.rs to identify all public methods in the AidEscrow impl block
- Extract method signatures, parameters, and return types
- Compare against existing method reference table
- Add missing methods with descriptions and auth requirements
- Ensure consistent formatting across all entries

### Component 2: CONTRIBUTING Example Updater

**Purpose**: Update code examples in CONTRIBUTING.md to match current method signatures.

**Inputs**:
- Current CONTRIBUTING.md content
- Current method signatures from lib.rs

**Outputs**:
- Updated CONTRIBUTING.md with accurate examples

**Behavior**:
- Identify code examples in CONTRIBUTING.md (within code blocks)
- Extract method signatures from examples
- Compare against current implementation signatures
- Update parameter lists, types, and return types
- Update error type references to match current Error enum

### Component 3: Test Suite Expander

**Purpose**: Add tests for methods not currently covered in core_flow.rs.

**Inputs**:
- Current core_flow.rs test file
- List of methods requiring test coverage

**Outputs**:
- Expanded core_flow.rs with comprehensive test coverage

**Behavior**:
- Identify untested methods: batch_create_packages, extend_expiration, get_aggregates, set_config, get_config
- Write integration tests for each method covering:
  - Success path with valid inputs
  - Error conditions (using try_ variants)
  - State transitions and side effects
- Maintain existing tests for legacy API methods
- Follow existing test patterns and naming conventions

## Data Models

### Method Metadata Structure

For documentation generation, we conceptually work with:

```
MethodMetadata {
  name: String,
  parameters: Vec<Parameter>,
  return_type: String,
  auth_required: Option<String>,
  description: String,
  errors: Vec<String>
}

Parameter {
  name: String,
  type: String
}
```

### Test Coverage Matrix

Track which methods have test coverage:

```
TestCoverage {
  method_name: String,
  has_success_test: bool,
  has_error_test: bool,
  test_function_names: Vec<String>
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Documentation Completeness

*For any* public method in the AidEscrow implementation, the README method reference table should contain an entry documenting that method.

**Validates: Requirements 1.1, 5.1**

### Property 2: Example Signature Accuracy

*For any* code example in CONTRIBUTING.md that shows a method signature, the signature should match the current implementation in lib.rs.

**Validates: Requirements 3.1, 5.2**

### Property 3: Error Type Validity

*For any* error type referenced in documentation examples or test assertions, that error type should exist in the current Error enum definition.

**Validates: Requirements 3.4, 7.3**

### Property 4: Test Signature Accuracy

*For any* method call in core_flow.rs tests, the method signature (name, parameters, types) should match the current implementation in lib.rs.

**Validates: Requirements 7.1**

### Property 5: Test Quality - Dual Path Coverage

*For any* test function that validates a contract method, the test should include both a successful execution path and at least one error condition check (using try_ variant).

**Validates: Requirements 4.6**

### Property 6: Data Structure Documentation

*For any* public data structure (struct or enum) used in the AidEscrow contract, the README should include a description of that structure.

**Validates: Requirements 5.3**

## Error Handling

This feature primarily deals with documentation and tests, so error handling is minimal:

### Documentation Updates
- If a method cannot be parsed from lib.rs, log a warning and continue
- If README structure is unexpected, fail with clear error message indicating format issue

### Test Expansion
- New tests should follow existing error handling patterns in core_flow.rs
- Use try_ variants to test error conditions
- Assert specific error types using assert_eq! with Error enum variants

### Validation
- If documentation-implementation mismatches are found, report them clearly
- Provide specific line numbers and method names for any inconsistencies

## Testing Strategy

This feature involves updating tests and documentation, so testing is meta-level:

### Manual Verification
- Review updated README.md to ensure all methods are documented
- Review updated CONTRIBUTING.md to ensure examples are accurate
- Run expanded core_flow.rs tests to ensure they pass

### Automated Validation (Optional)
- Script to parse lib.rs and extract public method signatures
- Script to parse README.md and verify all methods are documented
- Script to parse CONTRIBUTING.md examples and compare to implementation
- Script to parse core_flow.rs and verify test coverage

### Unit Tests
- No new unit tests required (this feature updates existing tests)
- Existing unit tests in core_flow.rs should continue to pass
- New tests added to core_flow.rs should follow existing patterns

### Property-Based Tests
- Property 1-6 could be validated with custom scripts that parse Rust code and markdown
- These would be one-time validation scripts rather than ongoing PBT
- Minimum 100 iterations not applicable (these are deterministic checks)

### Integration Tests
- The expanded core_flow.rs serves as integration tests
- Each new test should:
  - Set up contract state
  - Call the method being tested
  - Verify expected state changes
  - Test error conditions

### Test Configuration
- Use existing Soroban test framework
- Follow existing test patterns in core_flow.rs
- Each test should be self-contained with its own setup
