# PR: Upgrade/Migration Test Harness

## Summary
This PR adds regression coverage for Aid Escrow contract upgrade and migration behavior.

## What changed
- Added migration progression tests covering a real version path from v1 to v2 to v3.
- Added state compatibility assertions to ensure migrations preserve core contract state:
  - contract version
  - admin identity
  - config values
  - pause state
- Added invalid-transition coverage so repeated or downgraded versions fail with a clear InvalidState error.

## Why
These tests make upgrade and migration rules explicit and help prevent regressions where state compatibility breaks across contract versions.

## Testing
- Added/updated Rust contract tests in the Aid Escrow versioning suite.
- Verification was attempted locally, but the current Windows Rust toolchain environment blocked cargo execution with a local toolchain error.

## Notes
- Branch: feature/573-upgrade-migration-test-harness
- Commit: c3ca6c5
